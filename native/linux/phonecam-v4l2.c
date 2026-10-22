/*
 * phonecam-v4l2: decode the phone's H.264 stream from stdin and feed a
 * v4l2loopback device, so every app sees a normal "PhoneCam" webcam.
 *
 * Input framing on stdin: [u32 big-endian length][u8 flags][H.264 Annex B],
 * where length counts the flags byte plus the payload.
 *
 * The output is a steady stream of fixed-size I420 frames: video that doesn't
 * match the output size is letterboxed, and a placeholder is shown when the
 * phone is away, so apps never see the camera stall or disappear.
 *
 * Writes "K" to stdout whenever the decoder needs a fresh key frame.
 *
 * Build: cc -O2 -o phonecam-v4l2 phonecam-v4l2.c \
 *          $(pkg-config --cflags --libs libavcodec libswscale libavutil)
 */

#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#include <libavcodec/avcodec.h>
#include <libavutil/imgutils.h>
#include <libswscale/swscale.h>

#ifdef __linux__
#include <linux/videodev2.h>
#include <sys/ioctl.h>
#endif

#define IDLE_MS 2000
#define MAX_PACKET (8 * 1024 * 1024)

static int out_w = 1920;
static int out_h = 1080;
static int fps = 30;

static uint8_t *live_frame;
static uint8_t *idle_frame;
static size_t frame_size;
static int64_t last_picture_ms = -IDLE_MS;

static AVCodecContext *decoder;
static AVPacket *packet;
static AVFrame *picture;
static struct SwsContext *scaler;
static int src_w, src_h, src_fmt = -1;
static int out_fd = -1;
static int file_mode;
static uint8_t *dst_planes[3];
static int dst_strides[3];

static void write_frame(int fd, const uint8_t *frame);

static int64_t now_us(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (int64_t)ts.tv_sec * 1000000 + ts.tv_nsec / 1000;
}

static void die(const char *message) {
  fprintf(stderr, "phonecam-v4l2: %s\n", message);
  exit(1);
}

static void request_key_frame(void) {
  static int64_t last;
  int64_t t = now_us();
  if (t - last > 300000) {
    last = t;
    if (write(STDOUT_FILENO, "K", 1) < 0) {
      /* Parent is gone; stdin EOF will end the loop. */
    }
  }
}

static void fill(uint8_t *frame, uint8_t y, uint8_t u, uint8_t v) {
  size_t luma = (size_t)out_w * out_h;
  memset(frame, y, luma);
  memset(frame + luma, u, luma / 4);
  memset(frame + luma + luma / 4, v, luma / 4);
}

/* Dark frame with a soft lens circle: "camera on, phone not streaming". */
static void draw_idle_frame(void) {
  fill(idle_frame, 24, 128, 128);
  int cx = out_w / 2, cy = out_h / 2, r = out_h / 9;
  for (int y = cy - r; y <= cy + r; y++) {
    for (int x = cx - r; x <= cx + r; x++) {
      int d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d <= r * r && d >= (r - 10) * (r - 10)) {
        idle_frame[y * out_w + x] = 90;
      }
    }
  }
}

static int open_output(const char *device, const char *file) {
  if (file) {
    int fd = open(file, O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (fd < 0) {
      die("cannot open output file");
    }
    return fd;
  }

#ifdef __linux__
  int fd = open(device, O_WRONLY);
  if (fd < 0) {
    fprintf(stderr, "phonecam-v4l2: cannot open %s: %s\n", device, strerror(errno));
    exit(1);
  }

  struct v4l2_format format;
  memset(&format, 0, sizeof format);
  format.type = V4L2_BUF_TYPE_VIDEO_OUTPUT;
  format.fmt.pix.width = out_w;
  format.fmt.pix.height = out_h;
  format.fmt.pix.pixelformat = V4L2_PIX_FMT_YUV420;
  format.fmt.pix.field = V4L2_FIELD_NONE;
  format.fmt.pix.bytesperline = out_w;
  format.fmt.pix.sizeimage = frame_size;
  format.fmt.pix.colorspace = V4L2_COLORSPACE_REC709;
  if (ioctl(fd, VIDIOC_S_FMT, &format) < 0) {
    fprintf(stderr, "phonecam-v4l2: VIDIOC_S_FMT failed: %s\n", strerror(errno));
    exit(1);
  }

  struct v4l2_streamparm parm;
  memset(&parm, 0, sizeof parm);
  parm.type = V4L2_BUF_TYPE_VIDEO_OUTPUT;
  parm.parm.output.timeperframe.numerator = 1;
  parm.parm.output.timeperframe.denominator = fps;
  ioctl(fd, VIDIOC_S_PARM, &parm); /* Best effort; older modules ignore it. */
  return fd;
#else
  (void)device;
  die("v4l2 output is only available on Linux (use --output FILE)");
  return -1;
#endif
}

static void open_decoder(void) {
  const AVCodec *codec = avcodec_find_decoder(AV_CODEC_ID_H264);
  if (!codec) {
    die("this libavcodec has no H.264 decoder");
  }
  decoder = avcodec_alloc_context3(codec);
  decoder->flags |= AV_CODEC_FLAG_LOW_DELAY;
  /* Slice threading adds no latency; frame threading would add a frame per thread. */
  decoder->thread_type = FF_THREAD_SLICE;
  decoder->thread_count = 0;
  if (avcodec_open2(decoder, codec, NULL) < 0) {
    die("cannot open H.264 decoder");
  }
  packet = av_packet_alloc();
  picture = av_frame_alloc();
}

/* Scale the decoded picture into the output frame, keeping its aspect ratio. */
static void present(const AVFrame *frame) {
  if (!scaler || frame->width != src_w || frame->height != src_h || frame->format != src_fmt) {
    src_w = frame->width;
    src_h = frame->height;
    src_fmt = frame->format;

    double scale = (double)out_w / src_w < (double)out_h / src_h ? (double)out_w / src_w : (double)out_h / src_h;
    int dw = ((int)(src_w * scale)) & ~1;
    int dh = ((int)(src_h * scale)) & ~1;
    int ox = ((out_w - dw) / 2) & ~1;
    int oy = ((out_h - dh) / 2) & ~1;

    sws_freeContext(scaler);
    scaler = sws_getContext(src_w, src_h, src_fmt, dw, dh, AV_PIX_FMT_YUV420P, SWS_BILINEAR, NULL, NULL, NULL);
    if (!scaler) {
      die("cannot create scaler");
    }

    size_t luma = (size_t)out_w * out_h;
    fill(live_frame, 16, 128, 128);
    dst_planes[0] = live_frame + (size_t)oy * out_w + ox;
    dst_planes[1] = live_frame + luma + (size_t)(oy / 2) * (out_w / 2) + ox / 2;
    dst_planes[2] = live_frame + luma + luma / 4 + (size_t)(oy / 2) * (out_w / 2) + ox / 2;
    dst_strides[0] = out_w;
    dst_strides[1] = out_w / 2;
    dst_strides[2] = out_w / 2;
    fprintf(stderr, "phonecam-v4l2: input %dx%d -> %dx%d at (%d,%d)\n", src_w, src_h, dw, dh, ox, oy);
  }

  sws_scale(scaler, (const uint8_t *const *)frame->data, frame->linesize, 0, src_h, dst_planes, dst_strides);
  last_picture_ms = now_us() / 1000;
  if (file_mode) {
    /* Tests: one output frame per decoded picture, no pacing. */
    write_frame(out_fd, live_frame);
  }
}

static void decode(const uint8_t *data, int size) {
  packet->data = (uint8_t *)data;
  packet->size = size;
  int ret = avcodec_send_packet(decoder, packet);
  if (ret < 0 && ret != AVERROR(EAGAIN)) {
    request_key_frame();
    return;
  }
  for (;;) {
    ret = avcodec_receive_frame(decoder, picture);
    if (ret == AVERROR(EAGAIN) || ret == AVERROR_EOF) {
      break;
    }
    if (ret < 0) {
      request_key_frame();
      break;
    }
    if (picture->decode_error_flags) {
      request_key_frame();
    }
    present(picture);
    av_frame_unref(picture);
  }
}

static void write_frame(int fd, const uint8_t *frame) {
  size_t offset = 0;
  while (offset < frame_size) {
    ssize_t n = write(fd, frame + offset, frame_size - offset);
    if (n < 0) {
      if (errno == EINTR) {
        continue;
      }
      fprintf(stderr, "phonecam-v4l2: write failed: %s\n", strerror(errno));
      exit(1);
    }
    offset += (size_t)n;
  }
}

/* Parses as many complete packets as are buffered; returns bytes consumed. */
static size_t consume(uint8_t *buffer, size_t length, uint8_t *scratch) {
  size_t offset = 0;
  while (length - offset >= 4) {
    uint32_t size = ((uint32_t)buffer[offset] << 24) | ((uint32_t)buffer[offset + 1] << 16) |
                    ((uint32_t)buffer[offset + 2] << 8) | buffer[offset + 3];
    if (size < 1 || size > MAX_PACKET) {
      die("corrupt input framing");
    }
    if (length - offset - 4 < size) {
      break;
    }
    int payload = (int)size - 1;
    memcpy(scratch, buffer + offset + 5, payload);
    memset(scratch + payload, 0, AV_INPUT_BUFFER_PADDING_SIZE);
    decode(scratch, payload);
    offset += 4 + size;
  }
  return offset;
}

static void usage(void) {
  fprintf(stderr,
          "usage: phonecam-v4l2 (--device /dev/videoN | --output FILE) [--width 1920] [--height 1080] [--fps 30]\n");
  exit(2);
}

int main(int argc, char **argv) {
  const char *device = NULL;
  const char *file = NULL;

  for (int i = 1; i < argc; i++) {
    if (i + 1 >= argc) {
      usage();
    }
    if (!strcmp(argv[i], "--device")) {
      device = argv[++i];
    } else if (!strcmp(argv[i], "--output")) {
      file = argv[++i];
    } else if (!strcmp(argv[i], "--width")) {
      out_w = atoi(argv[++i]);
    } else if (!strcmp(argv[i], "--height")) {
      out_h = atoi(argv[++i]);
    } else if (!strcmp(argv[i], "--fps")) {
      fps = atoi(argv[++i]);
    } else {
      usage();
    }
  }
  if ((!device && !file) || out_w < 16 || out_h < 16 || (out_w & 1) || (out_h & 1) || fps < 1 || fps > 120) {
    usage();
  }

  signal(SIGPIPE, SIG_IGN);
  av_log_set_level(AV_LOG_ERROR);

  frame_size = (size_t)out_w * out_h * 3 / 2;
  live_frame = malloc(frame_size);
  idle_frame = malloc(frame_size);
  size_t capacity = 2 * MAX_PACKET + 16;
  uint8_t *input = malloc(capacity);
  uint8_t *scratch = malloc(MAX_PACKET + AV_INPUT_BUFFER_PADDING_SIZE);
  if (!live_frame || !idle_frame || !input || !scratch) {
    die("out of memory");
  }
  draw_idle_frame();

  file_mode = file != NULL;
  out_fd = open_output(device, file);
  open_decoder();
  fcntl(STDIN_FILENO, F_SETFL, fcntl(STDIN_FILENO, F_GETFL) | O_NONBLOCK);

  size_t buffered = 0;
  int input_open = 1;
  const int64_t interval = 1000000 / fps;
  int64_t next = now_us();

  while (input_open) {
    int64_t wait_us = next - now_us();
    struct pollfd fds = { .fd = STDIN_FILENO, .events = POLLIN };
    int timeout_ms = file_mode ? -1 : wait_us > 0 ? (int)((wait_us + 999) / 1000) : 0;
    int ready = poll(&fds, 1, timeout_ms);

    if (ready > 0 && (fds.revents & (POLLIN | POLLHUP))) {
      for (;;) {
        ssize_t n = read(STDIN_FILENO, input + buffered, capacity - buffered);
        if (n > 0) {
          buffered += (size_t)n;
          size_t used = consume(input, buffered, scratch);
          memmove(input, input + used, buffered - used);
          buffered -= used;
          continue;
        }
        if (n == 0) {
          input_open = 0;
        }
        break;
      }
    }

    /* On EOF the CLI has exited: stop rather than show a frozen frame. */
    int64_t now = now_us();
    if (!file_mode && input_open && now >= next) {
      int idle = now / 1000 - last_picture_ms > IDLE_MS;
      write_frame(out_fd, idle ? idle_frame : live_frame);
      next += interval;
      if (now - next > interval) {
        next = now + interval;
      }
    }
  }

  close(out_fd);
  return 0;
}
