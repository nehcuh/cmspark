/* Mac native launcher fixture, never shipped or used as an authority oracle. */
#include <unistd.h>
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <spawn.h>
#include <sys/wait.h>
extern char **environ;
int main(int argc, char **argv) {
  if (argc == 2 && !strcmp(argv[1], "--descendant")) {
    char byte; errno=0;
    if (read(0,&byte,1) != -1 || errno != EBADF) return 31;
    for (int fd=3;fd<1024;fd++) if (fcntl(fd,F_GETFD) != -1) return 32;
    return 0;
  }
  if (argc != 1) return 11;
  for (char **v=environ;*v;v++) if (strncmp(*v,"PATH=",5) && strncmp(*v,"LANG=",5)) return 12;
  char input[4097];size_t total=0;
  for(;;){ssize_t n=read(0,input+total,sizeof(input)-1-total);if(n<0 && errno==EINTR)continue;if(n<0)return 13;if(!n)break;total+=(size_t)n;if(total>=sizeof(input)-1)return 14;}
  close(0);input[total]=0;
  if(!strstr(input,"\"capability_id\":") || !strstr(input,"\"secret\":") || !strstr(input,"\"url\":") || strstr(input,"parent_handle"))return 15;
  for(int fd=3;fd<1024;fd++)if(fcntl(fd,F_GETFD)!=-1)return 16;
  volatile char *wipe=input;for(size_t i=0;i<sizeof(input);i++)wipe[i]=0;
  posix_spawnattr_t attr;posix_spawnattr_init(&attr);posix_spawnattr_setflags(&attr,POSIX_SPAWN_CLOEXEC_DEFAULT);
  char *childArgs[]={argv[0],"--descendant",NULL};pid_t child;
  int rc=posix_spawn(&child,argv[0],NULL,&attr,childArgs,environ);posix_spawnattr_destroy(&attr);if(rc)return 17;
  int status;while(waitpid(child,&status,0)<0){if(errno!=EINTR)return 18;}
  return WIFEXITED(status)?WEXITSTATUS(status):19;
}
