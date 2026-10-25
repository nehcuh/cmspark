/** Test-only passive source observation. Production Linux helper remains byte-identical. */
import {types} from 'node:util'
const prelude758=String.raw`# Test-only passive app enumeration observation. No window/process/text identity retained.
import errno as _d758_errno

class _D758Observation:
    def __init__(self, stack):
        self.stack_kind = 1 if type(stack) is list else 2 if type(stack) is bytes else 3
        self.stack_count = len(stack) if type(stack) in (list, bytes) else 0
        self.ordinal = 0
        self.stage = 0
        self.rows = []
        self.invalid = False


def _d758_begin(desktop, stack):
    try:
        desktop._d758_observation = _D758Observation(stack)
    except Exception:
        pass


def _d758_next(desktop):
    try:
        observation = desktop._d758_observation
        observation.ordinal += 1
        observation.stage = 0
    except Exception:
        pass


def _d758_mark(desktop, point):
    try:
        desktop._d758_observation.stage = point
    except Exception:
        pass


def _d758_record(desktop, error=None):
    try:
        observation = desktop._d758_observation
        category = 0
        errno_category = 0
        if isinstance(error, OSError):
            category = 6
            code = error.errno
            errno_category = {_d758_errno.ENOENT: 1, _d758_errno.EACCES: 2, _d758_errno.EPERM: 3, _d758_errno.ESRCH: 4}.get(code, 5) if type(code) is int else 5
        elif error is not None:
            category = 5
            if type(error) is RuntimeError and len(error.args) == 1 and type(error.args[0]) is str:
                category = {"WINDOW_NOT_VISIBLE": 1, "XRES_IDENTITY_UNAVAILABLE": 2, "FOREIGN_PROCESS": 3, "PROTECTED_APPLICATION": 4}.get(error.args[0], 5)
        if len(observation.rows) < 4096:
            observation.rows.append([observation.ordinal, observation.stage, category, errno_category])
        else:
            observation.invalid = True
    except Exception:
        pass


def _d758_snapshot(desktop, app_count):
    try:
        observation = desktop._d758_observation
        return {"schema": 1, "stackKind": observation.stack_kind, "stackCount": observation.stack_count, "visited": observation.ordinal, "infoReturned": sum(row[2] == 0 for row in observation.rows), "runtimeRefusals": sum(1 <= row[2] <= 5 for row in observation.rows), "osRefusals": sum(row[2] == 6 for row in observation.rows), "appCount": app_count, "rows": observation.rows, "invalid": observation.invalid}
    except Exception:
        return None


`
const marks758=[
 [1,'info: XGetWindowAttributes/map_state original guard'],
 [2,'info: original client_pid call'],
 [3,'client_pid: original XResQueryClientIds call'],
 [4,'client_pid: original count/ids/mask guard'],
 [5,'client_pid: original XResGetClientPid call'],
 [6,'client_pid: original pid/owner and proc stat guard'],
 [7,'info: original proc exe readlink'],
 [8,'info: original executable/protected guard'],
 [9,'info: original proc stat open'],
 [10,'info: original proc stat stream read'],
 [11,'info: original optional title expression'],
 [12,'info: original return expression'],
]
const marked=(point,text)=>'        _d758_mark(self, '+point+')\n'+text
const patches758=[
 ['        if not self.x.XGetWindowAttributes(self.display, window, C.byref(attr)) or attr.map_state != 2:',marked(1,'        if not self.x.XGetWindowAttributes(self.display, window, C.byref(attr)) or attr.map_state != 2:')],
 ['        pid = self.client_pid(window)',marked(2,'        pid = self.client_pid(window)')],
 ['        if self.res.XResQueryClientIds(self.display, 1, C.byref(spec), C.byref(count), C.byref(ids)) != 0:',marked(3,'        if self.res.XResQueryClientIds(self.display, 1, C.byref(spec), C.byref(count), C.byref(ids)) != 0:')],
 ['            if count.value != 1 or not ids or ids[0].spec.mask != 2:','            _d758_mark(self, 4)\n            if count.value != 1 or not ids or ids[0].spec.mask != 2:'],
 ['            pid = self.res.XResGetClientPid(C.byref(ids[0]))','            _d758_mark(self, 5)\n            pid = self.res.XResGetClientPid(C.byref(ids[0]))'],
 ['            if pid <= 0 or os.stat(f"/proc/{pid}").st_uid != os.getuid():','            _d758_mark(self, 6)\n            if pid <= 0 or os.stat(f"/proc/{pid}").st_uid != os.getuid():'],
 ['        exe = os.readlink(f"/proc/{pid}/exe")',marked(7,'        exe = os.readlink(f"/proc/{pid}/exe")')],
 ['        if not exe.startswith("/") or exe.endswith(" (deleted)") or PROTECTED.search(exe):',marked(8,'        if not exe.startswith("/") or exe.endswith(" (deleted)") or PROTECTED.search(exe):')],
 ['        with open(f"/proc/{pid}/stat", encoding="utf-8") as stream:',marked(9,'        with open(f"/proc/{pid}/stat", encoding="utf-8") as stream:')],
 ['            started = stream.read(8192).rpartition(")")[2].split()[19]','            _d758_mark(self, 10)\n            started = stream.read(8192).rpartition(")")[2].split()[19]'],
 ['        title = (self.prop(window, "_NET_WM_NAME") or self.prop(window, "WM_NAME")) if include_title else b""',marked(11,'        title = (self.prop(window, "_NET_WM_NAME") or self.prop(window, "WM_NAME")) if include_title else b""')],
 ['        return {"window": window, "pid": pid, "started": started, "app_id": "linux." + hashlib.sha256(exe.encode()).hexdigest(), "app_name": os.path.basename(exe)[:200], "title": title}',marked(12,'        return {"window": window, "pid": pid, "started": started, "app_id": "linux." + hashlib.sha256(exe.encode()).hexdigest(), "app_name": os.path.basename(exe)[:200], "title": title}')],
 ['        if argv == ["apps"]:\n            stack = desktop.prop(desktop.root, "_NET_CLIENT_LIST_STACKING")','        if argv == ["apps"]:\n            stack = desktop.prop(desktop.root, "_NET_CLIENT_LIST_STACKING")\n            _d758_begin(desktop, stack)'],
 ['            for window in stack:\n                try:','            for window in stack:\n                _d758_next(desktop)\n                try:'],
 ['                    info = desktop.info(window, False)\n                    if len(apps) < 200:','                    info = desktop.info(window, False)\n                    _d758_record(desktop)\n                    if len(apps) < 200:'],
 ['                except (OSError, RuntimeError):\n                    continue','                except (OSError, RuntimeError) as error758:\n                    _d758_record(desktop, error758)\n                    continue'],
 ['            return {"ok": True, "apps": list(apps.values())}','            return {"ok": True, "apps": list(apps.values()), "observation758": _d758_snapshot(desktop, len(apps))}'],
 ['def main(argv):',prelude758+'def main(argv):'],
]
function once758(value,from,to){if(value.split(from).length!==2)throw Error('ACTIVITY758_OBSERVATION_ANCHOR');return value.replace(from,to)}
export function desktopLinuxAppsObservation758(original){
 if(typeof original!=='string'||!original.length||original.includes('_d758_observation'))throw Error('ACTIVITY758_OBSERVATION_SOURCE')
 const eol=original.includes('\r\n')?'\r\n':'\n',parts=patches758.map(([a,b])=>[a.replace(/\n/g,eol),b.replace(/\n/g,eol)])
 let source=original;for(const[a,b]of parts)source=once758(source,a,b)
 let inverse=source;for(const[a,b]of [...parts].reverse())inverse=once758(inverse,b,a)
 if(inverse!==original)throw Error('ACTIVITY758_OBSERVATION_INVERSE')
 return{source,inverse,sites:marks758.map(([point,operation])=>({point,operation})),productionChanged:false}
}
function record758(value,keys){
 if(!value||typeof value!=='object'||types.isProxy(value))return null
 const own=Reflect.ownKeys(value);if(own.length!==keys.length||own.some((k,i)=>k!==keys[i]))return null
 const output={};for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!Object.hasOwn(d,'value'))return null;output[key]=d.value}return output
}
const uint758=(v,max)=>Number.isSafeInteger(v)&&v>=0&&v<=max
export function projectLinuxAppsObservation758(value){
 const unknown=()=>({status:'UNKNOWN',reason:'INVALID_SNAPSHOT'})
 try{
  const s=record758(value,['schema','stackKind','stackCount','visited','infoReturned','runtimeRefusals','osRefusals','appCount','rows','invalid']);if(!s||s.schema!==1||![1,2,3].includes(s.stackKind)||!uint758(s.stackCount,4096)||!uint758(s.visited,4096)||!uint758(s.infoReturned,4096)||!uint758(s.runtimeRefusals,4096)||!uint758(s.osRefusals,4096)||!uint758(s.appCount,200)||typeof s.invalid!=='boolean'||s.invalid||types.isProxy(s.rows)||!Array.isArray(s.rows)||s.rows.length!==s.visited||s.visited!==s.stackCount)return unknown()
  const outerKeys=Reflect.ownKeys(s.rows);if(outerKeys.length!==s.rows.length+1||outerKeys.some((k,i)=>k!==(i===s.rows.length?'length':String(i))))return unknown()
  const rows=[];for(let i=0;i<s.rows.length;i++){
   const item=Object.getOwnPropertyDescriptor(s.rows,String(i));if(!item||!Object.hasOwn(item,'value'))return unknown();const row=item.value;if(types.isProxy(row)||!Array.isArray(row)||row.length!==4||Reflect.ownKeys(row).length!==5)return unknown()
   const out=[];for(let n=0;n<4;n++){const d=Object.getOwnPropertyDescriptor(row,String(n));if(!d||!Object.hasOwn(d,'value'))return unknown();out.push(d.value)}
   if(out[0]!==i+1||!uint758(out[1],12)||out[1]<1||!uint758(out[2],6)||!uint758(out[3],5)||(out[2]===6?out[3]<1:out[3]!==0))return unknown();rows.push(out)
  }
  if(rows.filter(r=>r[2]===0).length!==s.infoReturned||rows.filter(r=>r[2]>=1&&r[2]<=5).length!==s.runtimeRefusals||rows.filter(r=>r[2]===6).length!==s.osRefusals||s.appCount>Math.min(200,s.infoReturned))return unknown()
  const snapshot={schema:1,stackKind:s.stackKind,stackCount:s.stackCount,visited:s.visited,infoReturned:s.infoReturned,runtimeRefusals:s.runtimeRefusals,osRefusals:s.osRefusals,appCount:s.appCount,rows,invalid:false}
  if(Buffer.byteLength(JSON.stringify(snapshot),'utf8')>131072)return unknown()
  return{status:'OBSERVED',snapshot}
 }catch{return unknown()}
}
