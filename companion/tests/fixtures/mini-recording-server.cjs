// Isolated Mini HTTP service. Only the speech model and tray socket peer are substitutes.
const fs = require("node:fs")
const path = require("node:path")
const data = process.env.CMSPARK_DATA_DIR
if (!data || fs.readdirSync(data).length) throw new Error("Empty fixture data directory required")
const web = require("../../dist/summoner-web")
const { handleMeetingMessage } = require("../../dist/meeting/meeting-handlers")
const { handleVoiceSttMessage } = require("../../dist/voice/stt-handlers")
const { SttSessionService } = require("../../dist/voice/stt-session-service")
require("../../dist/config").setVoiceFields({sttEngine:"local",localModelId:"medium"})
const service = new SttSessionService({
  dataDir:data,whisperRoot:data,probeModel:()=>({status:"ready"}),resolveModelPath:()=>path.join(data,"owned.bin"),
  resolveBinary:()=>({ok:true,path:"fixture",arch:"win32-x64",pinned:true,sha256:"fixture"}),
  runWhisper:async()=>({text:"合成会议",ms:1})
})
const ctx = { peerId:"fixture-tray",origin:"cmspark-tray://local",surface:"summoner",send:web.pushSummonerWebEvent }
const connection = {}
web.startSummonerWebServer({
  preferredPort:25340,meetingPcmConnection:()=>connection,observeMeetingPcm:async()=>1,
  dispatch:async msg=>msg.type.startsWith("meeting.") ? handleMeetingMessage(msg,ctx,{sttService:service}) :
    msg.type.startsWith("voice.stt.") ? handleVoiceSttMessage(msg,ctx,{service}) : {type:"ok"}
}).then(({port})=>fs.writeFileSync(path.join(data,"port"),String(port)))
