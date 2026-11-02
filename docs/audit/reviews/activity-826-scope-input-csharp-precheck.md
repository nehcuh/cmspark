# #826 owned scope click — C# implementation precheck

Status: **no concrete blocker found in the current C# precheck; NOT a formal source approval**. Consumers and tests are still being authored separately. Formal unit approval must follow their freeze and actual machine controls. No source/config edit, dispatch, commit, input injection or Windows runtime execution by this reviewer.

Read current `companion/tests/fixtures/activity-scope825-windows.cs`, its actual existing compiler helper/reference list, and `/tmp/cmspark-826-scope-input-glm-design.md`.

## API/reference reachability

The existing csc command references PresentationCore, PresentationFramework, WindowsBase and System.Xaml under .NET Framework4. Public inherited WPF methods used here exist in PresentationCore and official applicability includes Framework4.0: [UIElement.InputHitTest](https://learn.microsoft.com/en-us/dotnet/api/system.windows.uielement.inputhittest?view=windowsdesktop-10.0), [Visual.PointFromScreen](https://learn.microsoft.com/en-us/dotnet/api/system.windows.media.visual.pointfromscreen?view=windowsdesktop-10.0), [PresentationSource.FromVisual](https://learn.microsoft.com/en-us/dotnet/api/system.windows.presentationsource.fromvisual?view=windowsdesktop-10.0), [Visual.IsAncestorOf](https://learn.microsoft.com/dotnet/api/system.windows.media.visual.isancestorof). No newer-framework-only API was found. Real Windows compilation remains required; macOS has not compiled this WPF fixture.

P/Invoke declarations match the actual called Windows signatures: 32-bit LONG/POINT/RECT coordinates and DWORD fields, pointer-width extra info/HWND, POINT passed by value to WindowFromPoint, DWORD thread return/PID out, and 32-bit BOOL. SendInput uses its actual inserted-count return and actual Marshal.SizeOf cbSize. See [official INPUT](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-input), [MOUSEINPUT](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-mouseinput), [SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput).

The mouse-only Sequential Input is not a C# union declaration, but for the three type0 entries it has the same size and Mouse offset as the actual largest native union member. Using clang's actual Windows x86_64/i686 ABI targets, I independently syntax-compiled static assertions comparing this field layout with a real native INPUT union: x64 size40 and x86 size28, with matching Mouse offsets. `/tmp/cmspark-826-scope-input-abi-precheck.cpp` and `.log`; both compiler commands exited0. This establishes native layout expectations, **not** a CLR Marshal.SizeOf experiment. Actual Windows must still execute the existing40/28 Marshal guard before any input.

## Guard and event path

The root Window performs InputHitTest after converting the actual floored integer screen point back into that window's coordinates. It is not a hit test rooted only at the intended TextBox subtree. The returned element must be the inert TextBox or its descendant. Finite geometry, actual visual source/HWND, client coordinates, virtual bounds, WindowFromPoint root identity and actual current-process PID all precede the single SendInput call.

Negative virtual origins are subtracted before normalization; bound checks use widened addition, and width/height1-or-less reject before division. The batch is absolute virtual-desktop motion plus down/up, with zero-initialized type0/data/time/extra. The current source correctly treats SendInput's inserted count as input setup only; readiness still depends on the original actual foreground/focus predicates. Hit-test and input are separate calls, so no atomic HWND-targeting claim is justified.

At ContentRendered, requested is set before the setup call. setupComplete remains false until exactly three inputs were inserted; the check delegate returns immediately while false. A short insertion or other rejected setup writes the distinct setup failure category and requests shutdown; later queued focus/activation/render callbacks cannot publish ready with setupComplete false. There is no retry or Activate/Focus fallback. Replayed current events may recheck original readiness but cannot resend. Main and popup closures each have their own one-shot state; resize retains that closure and does not add a click.

This precheck supports proceeding with the planned real source-derived tests. It does not yet approve their correctness, assert native Windows success, or relax original10s/180s/business/cleanup requirements.
