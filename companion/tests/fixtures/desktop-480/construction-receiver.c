#include <unistd.h>
int main(void) {
  char input[4096];
  while (read(STDIN_FILENO, input, sizeof(input)) > 0) {}
#ifdef DESKTOP_FIXTURE_EXIT
  return 7;
#else
  for (;;) pause();
#endif
}
