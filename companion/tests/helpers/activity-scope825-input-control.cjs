// CPU adapter for the actual unshipped C# setup body. It cannot prove Win32 input.
'use strict'
const assert = require('node:assert/strict')
function adaptSetup(source) {
  const matches = [...source.matchAll(/static void SetupOwnedClick\(Window window, TextBox focus, bool rendered\) \{([\s\S]*?)\r?\n  \}/g)]
  assert.equal(matches.length, 1)
  let body = matches[0][1]
  const port = (before, after) => { assert.equal(body.split(before).length, 2, before); body = body.replace(before, after) }
  port('var presentation = PresentationSource.FromVisual(focus) as HwndSource;', 'const presentation = PresentationSource.FromVisual(focus);')
  port('var hitElement = window.InputHitTest(window.PointFromScreen(new Point(point.X, point.Y))) as DependencyObject;', 'const hitElement = window.InputHitTest(window.PointFromScreen(new Point(point.X, point.Y)));')
  port('double width = focus.ActualWidth, height = focus.ActualHeight;', 'const width = focus.ActualWidth, height = focus.ActualHeight;')
  port('var point = new NativePoint { X = (int)Math.Floor(screen.X), Y = (int)Math.Floor(screen.Y) };', 'const point = { X: Math.Floor(screen.X), Y: Math.Floor(screen.Y) };')
  port('Point screen =', 'const screen ='); port('Point local =', 'const local =')
  port('NativeRect client; var clientPoint = point;', 'let client; const clientPoint = { ...point };')
  port('GetClientRect(hwnd, out client)', 'GetClientRect(hwnd, value => client = value)')
  port('ScreenToClient(hwnd, ref clientPoint)', 'ScreenToClient(hwnd, clientPoint)')
  port('int left =', 'const left ='); port('int inputSize = Marshal.SizeOf(typeof(Input));', 'const inputSize = Marshal.SizeOf("Input");')
  port('uint pid;', 'let pid;'); port('GetWindowThreadProcessId(hwnd, out pid)', 'GetWindowThreadProcessId(hwnd, value => pid = value)')
  port('(uint)Process.GetCurrentProcess().Id', 'Process.GetCurrentProcess().Id')
  port('var batch = new Input[3];', 'const batch = Array.from({ length: 3 }, () => ({ Type: 0, Mouse: { X: 0, Y: 0, Data: 0, Flags: 0, Time: 0, ExtraInfo: 0 } }));')
  body = body.replace(/new Exception\(/g, 'new Error(').replace(/\(long\)|\(double\)|\(int\)/g, '')
  assert.doesNotMatch(body, /out |ref | as |typeof\(Input\)|new Input|\(u?int\)|\(long\)|\bdouble\b/)
  return body
}
function inputLayout(source, pointerSize) {
  const types = { int: [4, 4], uint: [4, 4], IntPtr: [pointerSize, pointerSize] }
  const layout = name => {
    const pattern = new RegExp('\\[StructLayout\\(LayoutKind.Sequential\\)\\] struct ' + name + ' \\{([^}]+)\\}', 'g')
    const rows = [...source.matchAll(pattern)]; assert.equal(rows.length, 1)
    let size = 0, align = 1; const offsets = {}
    for (const field of rows[0][1].trim().split(';').map(x => x.trim()).filter(Boolean)) {
      const match = /^public (\w+) ([\w, ]+)$/.exec(field); assert.ok(match, field)
      const type = types[match[1]]; assert.ok(type, match[1])
      for (const key of match[2].split(',').map(x => x.trim())) { size = Math.ceil(size / type[1]) * type[1]; offsets[key] = size; size += type[0]; align = Math.max(align, type[1]) }
    }
    return { size: Math.ceil(size / align) * align, align, offsets }
  }
  const mouse = layout('MouseInput'); types.MouseInput = [mouse.size, mouse.align]
  return { mouse, input: layout('Input') }
}
module.exports = { adaptSetup, inputLayout }
