# Independent design/experiment review —826 compiler file-fd/cwd

VERDICT: APPROVE for the bounded file-fd/stable-cwd design, including the explicitly required actual live-descendant owned-directory removal control on Windows. No source implementation or CI run performed.

Reviewed /tmp/cmspark-826-compiler-stdio-cwd-design.md, actual compiler call/options/artifact paths and existing primary-error cleanup control. This candidate addresses a supported observed path; it does not identify the physical cause of either historical MSVC timeout.

## Independent actual process experiments

Node22.23.4 on macOS:

1. Replayed /tmp/cmspark-826-inherited-stdio-probe.mjs. Direct parent exited0 while its known descendant retained stdout/stderr. Pipes:503ms, ETIMEDOUT with status0/signalnull and descendant actually alive. File fds:33ms, no error, parent0 and descendant not finished; both known descendants later naturally completed.
2. Replayed real node--test outer-runner control. inherit: inner compiler succeeded, case printed PASS, but outer runner803ms ETIMEDOUT because descendant retained its captured stream. File fds: outer70ms, complete PASS while descendant remained unfinished. inherit is therefore unsuitable for this actual runner chain.
3. Built a small independent cleanup control: IPC-ready confirms the descendant is alive before direct parent exits; stable cwd is outside owned-output directory; stdout/stderr are wx+0600 files inside it. Actual rmSync(owned-output,{recursive:true,force:true}) succeeds while PID liveness is confirmed before and after and completion marker is absent. The same descendant subsequently writes through its inherited deleted-file fd, and the retained fd reads the exact late bytes. Natural completion follows. This establishes the local cleanup path rather than merely citing file-share flags.

Evidence: /tmp/cmspark-826-inherited-stdio-independent.log; /tmp/cmspark-826-inherit-runner-independent.log; /tmp/cmspark-826-filefd-live-cleanup-independent.mjs and same stem.log. The cleanup probe initially compared lexical /var with physical /private/var; only the temporary harness comparison was corrected to realpath before the successful run. No product inference came from that setup assertion.

## Official and actual-call evidence

[Exact Node22.23.4 spawn_sync.cc](https://raw.githubusercontent.com/nodejs/node/v22.23.4/src/spawn_sync.cc) explicitly handles timeout after the direct child has exited when a descendant retains stdio pipes. [Version-matched child_process documentation](https://raw.githubusercontent.com/nodejs/node/v22.23.4/doc/api/child_process.md) distinguishes exit from stdio closure and documents numeric shared file descriptors. These independently support the reproduced transport distinction, not an attribution to cl/link.

[Windows inheritance](https://learn.microsoft.com/en-us/windows/win32/procthread/inheritance) includes cwd; [SetCurrentDirectory](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-setcurrentdirectory) documents its directory lock. Moving compiler cwd to stable companion root avoids deliberately giving descendants the directory that the test removes. [MSVC Fo](https://learn.microsoft.com/en-us/cpp/build/reference/fo-object-file-name) and [Fd](https://learn.microsoft.com/en-us/cpp/build/reference/fd-program-database-file-name) support explicit owned obj/PDB paths; source/exe paths are already owned absolute paths. [Bundled libuv Windows open](https://raw.githubusercontent.com/nodejs/node/v22.23.4/deps/uv/src/win/fs.c) includes read/write/delete sharing. That file property alone is not proof of complete Windows directory removal.

## Approved implementation/acceptance limits

- Only compiler stdout/stderr become separate owned wx+0600 regular files, stdio ignore/outFd/errFd. Do not inherit outer runner streams or create replacement compiler pipes.
- Keep exact built.error and status guards. A successful direct exit does not establish descendant completion; actual fresh executable execution and existing controls remain necessary. Read at most64KiB of existing failure logs without waiting for append/EOF; diagnostic read failures cannot replace compiler errors.
- Local finally closes every already-open fd on first/second-open, spawn and assertion failures. Existing primary priority and cleanup-only failure remain. No new process-tree scanner, descendant wait/retry or lifecycle framework.
- cwd is stable repo; explicit owned Fo/Fd/OUT and existing absolute clang output prevent artifact spills. Original30s/20s/6s and native20s remain.
- Add the same actual live-descendant file-fd plus complete owned-directory rmSync control to the affected test entrance so Windows exercises the remaining platform fact. This is an explicit platform gate, not an assumption from macOS or share flags.

The remaining Windows-specific cleanup/compiler uncertainty does not itself block one purposefully changed-head validation: actual controls and unchanged error/status guards will reject unsupported behavior. It does block claiming Windows success before that run. Actual source increment and GLM gates still follow before CI.
