// CI fixture admission only: no process, environment inheritance, grants or writes.
import fs from 'node:fs'
export function prepareOwnedShortRoots(longRoot, shortRoot, expectedDirectory, io = fs) {
  try {
    if ([longRoot, shortRoot, expectedDirectory].some(p => typeof p !== 'string' || !p || /[\0\r\n]/.test(p)) ||
      longRoot === shortRoot || !/~[0-9]/i.test(shortRoot)) throw Error('invalid locator')
    const snapshot = p => {
      const s = io.lstatSync(p, { bigint: true })
      if (!s.isDirectory() || s.isSymbolicLink() || s.ino <= 0n || s.dev < 0n) throw Error('invalid identity')
      return s
    }
    const same = (a, b) => a.dev === b.dev && a.ino === b.ino
    const canonical = io.realpathSync.native(expectedDirectory)
    if (longRoot !== canonical || io.realpathSync.native(longRoot) !== canonical || io.realpathSync.native(shortRoot) !== canonical) throw Error('foreign locator')
    const initial = snapshot(longRoot)
    if (!same(initial, snapshot(shortRoot)) || !same(initial, snapshot(expectedDirectory))) throw Error('different identity')
    const validate = () => {
      try {
        if (io.realpathSync.native(expectedDirectory) !== canonical || io.realpathSync.native(longRoot) !== canonical ||
          io.realpathSync.native(shortRoot) !== canonical || !same(initial, snapshot(expectedDirectory)) ||
          !same(initial, snapshot(longRoot)) || !same(initial, snapshot(shortRoot))) throw Error('changed fixture')
      } catch { throw Error('CENSUS_OWNED_SHORT_ROOT_INVALID') }
    }
    return Object.freeze({ longRoot, shortRoot, validate })
  } catch { throw Error('CENSUS_OWNED_SHORT_ROOT_INVALID') }
}
