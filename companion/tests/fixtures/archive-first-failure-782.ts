/** Passive Archive-only diagnostic. Missing observations remain UNKNOWN. */
import { createHash } from "node:crypto"
import assert from "node:assert/strict"
export function createArchiveFirstFailure782(platform:string){
 let first:{origin:"R"|"W"|"S";site:number}|null=null,kind:"ARCHIVE_PHASE"|"SCRIPT"|"DUPLICATE"|null=null,sealed=false
 return{
  observe(frame:unknown){try{
   if(sealed||first||!frame||typeof frame!=="object")return
   const keys=Reflect.ownKeys(frame);if(keys.length!==2||!keys.includes("type")||!keys.includes("id"))return
   const descriptors=Object.getOwnPropertyDescriptors(frame),type=descriptors.type,id=descriptors.id
   if(!type||!id||!("value"in type)||!("value"in id)||type.value!=="system.ping"||typeof id.value!=="string"||id.value.length>24)return
   const match=/^D476_ARCHIVE_FIRST_([RWS])_([1-9]|10)$/.exec(id.value)
   if(!match||match[0]!==id.value)return
   const origin=match[1]as"R"|"W"|"S",site=Number(match[2]);if(origin!=="R"&&platform!=="win32"||origin==="W"&&site>8||origin==="S"&&site>2)return
   first={origin,site}
  }catch{/* Observation cannot change the original failure. */}},
  failure(id:string){if(sealed)return;kind=id==="D476_FAIL_ARCHIVE_PHASE"?"ARCHIVE_PHASE":id==="D476_FAIL_SCRIPT"?"SCRIPT":id==="DUPLICATE"?"DUPLICATE":null;sealed=true},
  snapshot(){sealed=true;return{schema:1,first:first?{...first}:null,kind}}
 }
}

/** Reverse the separately reviewed terminal admission ordering before older source seals. */
export function terminalAdmissionInverse801(raw:string){
 const eol=raw.includes("\r\n")?"\r\n":"\n"
 const pairs:[string,string][]=[
  ["function hostedTerminalHost705() {", "function hostedTerminalAdmission705() {"],
  ["}\nfunction hostedTerminalAdmission705() {\n hostedTerminalHost705()\n const run=", " const run="],
  [" hostedTerminalHost705()\n return withSurface650(t,async(t,surfaceLease)=>{\n  const owned=hostedTerminalAdmission705()", " const owned=hostedTerminalAdmission705()\n return withSurface650(t,async(t,surfaceLease)=>{"]
 ]
 let value=raw
 for(const [after,before] of pairs){const from=after.replace(/\n/g,eol),to=before.replace(/\n/g,eol);assert.equal(value.split(from).length,2,'TERMINAL_ADMISSION_801_SOURCE_DRIFT');value=value.replace(from,to)}
 return value
}

/** Undo only this Node observation before every older whole-source authority. */
export function archiveObservationInverse782(raw:string){
 const eol=raw.includes("\r\n")?"\r\n":"\n";let value=terminalAdmissionInverse801(raw)
 const pairs:[string,string][]=[["await initDataDir();saveConfig({llm:{base_url:\"http://127.0.0.1:1\",api_key:\"owned-native-fixture-only\",model_name:\"owned-controlled\",temperature:0,context_window:8000}}as any, { llmKey: true })","await initDataDir();saveConfig({llm:{base_url:\"http://127.0.0.1:1\",api_key:\"owned-native-fixture-only\",model_name:\"owned-controlled\",temperature:0,context_window:8000}}as any)"],["import { createArchiveFirstFailure782 } from \"./fixtures/archive-first-failure-782\"\nimport { createConfirmationObservation772 }", "import { createConfirmationObservation772 }"], ["  const archiveObservation=createArchiveFirstFailure782(process.platform)\n  const required=[\"D476_ARCHIVE_ARCHIVED\"", "  const required=[\"D476_ARCHIVE_ARCHIVED\""], ["if(!authenticated||f.type!==\"system.ping\")return;archiveObservation.observe(f);if(f.id===\"D476_ARCHIVE_BLOCK\")", "if(!authenticated||f.type!==\"system.ping\")return;if(f.id===\"D476_ARCHIVE_BLOCK\")"], ["if(f.id===\"D476_FAIL_ARCHIVE_PHASE\"||f.id===\"D476_FAIL_SCRIPT\"){archiveObservation.failure(f.id);failed=true;failResolve();return}if(required.includes(f.id)){if(receipts.has(f.id)){archiveObservation.failure(\"DUPLICATE\");failed=true;failResolve()}receipts.add(f.id)}", "if(f.id===\"D476_FAIL_ARCHIVE_PHASE\"||f.id===\"D476_FAIL_SCRIPT\"){failed=true;failResolve();return}if(required.includes(f.id)){if(receipts.has(f.id)){failed=true;failResolve()}receipts.add(f.id)}"], ["schema:1,failed,receiptMask:required.reduce((mask,id,i)=>mask|(receipts.has(id)?1<<i:0),0),sets,archived,restored,droppedAck,connections,authenticated,windowRequested,childExited,firstFailure:archiveObservation.snapshot()}))", "schema:1,failed,receiptMask:required.reduce((mask,id,i)=>mask|(receipts.has(id)?1<<i:0),0),sets,archived,restored,droppedAck,connections,authenticated,windowRequested,childExited}))"]]
 for(const [current,prior]of pairs){const from=current.replace(/\n/g,eol),to=prior.replace(/\n/g,eol);assert.equal(value.split(from).length,2,"ARCHIVE_OBSERVATION_782_SOURCE_DRIFT");value=value.replace(from,to)}
 const expected=eol==="\n"?"33b233999fcfcc764b4882749d7264aa534fc45938ff717dd23bcc51f4cdeaa6":"f4b0ae09fd52e2ed4fa2d112ebc041e1a33e5323776ddc3e00291c1a4bea4675"
 assert.equal(createHash("sha256").update(value).digest("hex"),expected,"ARCHIVE_OBSERVATION_782_SOURCE_DRIFT")
 return value
}
