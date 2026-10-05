// C entry for LiveEngine.lean (docs/wasm-spike.md). Initialises Lean once, keeps the runtime
// alive (no lean_finalize_task_manager: answers come later, from JS), and gives JS two
// C-string calls. Natively (no __EMSCRIPTEN__) `main LEANPATH REQUESTS.json` runs a batch
// so the same code is checked against the native toolchain.
#include <lean/lean.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

extern void lean_initialize(void);
extern lean_object * initialize_LiveEngine(uint8_t builtin);
extern lean_object * ramify_live_init(lean_object *);
extern lean_object * ramify_live_answer(lean_object *);

static char * call(lean_object * (*f)(lean_object *), const char * s) {
  lean_object * r = f(lean_mk_string(s));
  char * out;
  if (lean_io_result_is_ok(r)) {
    out = strdup(lean_string_cstr(lean_io_result_get_value(r)));
  } else {
    lean_io_result_show_error(r);
    out = strdup("{\"error\":\"uncaught IO error\"}");
  }
  lean_dec_ref(r);
  return out;
}

EMSCRIPTEN_KEEPALIVE char * ramify_init(const char * lean_path) { return call(ramify_live_init, lean_path); }
EMSCRIPTEN_KEEPALIVE char * ramify_answer(const char * request) { return call(ramify_live_answer, request); }

static double now_ms(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec * 1e3 + t.tv_nsec / 1e6; }

int main(int argc, char ** argv) {
  double t0 = now_ms();
  lean_initialize();
  lean_object * res = initialize_LiveEngine(1 /* builtin */);
  lean_io_mark_end_initialization();
  if (!lean_io_result_is_ok(res)) { lean_io_result_show_error(res); return 1; }
  lean_dec_ref(res);
  lean_init_task_manager();
  fprintf(stderr, "[live] runtime + module init %.0f ms\n", now_ms() - t0);
#ifndef __EMSCRIPTEN__
  if (argc < 3) { fprintf(stderr, "usage: %s LEANPATH REQUESTS.jsonl\n", argv[0]); return 2; }
  char * r = ramify_init(argv[1]); printf("%s\n", r); free(r);
  FILE * f = fopen(argv[2], "r"); char * line = NULL; size_t cap = 0;
  while (getline(&line, &cap, f) > 0) { r = ramify_answer(line); printf("%s\n", r); free(r); }
  free(line); fclose(f);
#endif
  return 0;
}
