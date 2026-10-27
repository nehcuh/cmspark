/** Fixed unshipped acceptance observations. No window identity, text or authority. */
export function createNativeObservation788(){
 const relations=['NULL','OWNED_MAIN','OWNED_CONFIRMATION','SAME_PROCESS_OTHER','OTHER_PROCESS','UNKNOWN'] as const
 type Relation={activationReturned:boolean;focusSucceeded:boolean;relation:string}
 let local:Relation|null=null,archive:Relation|null=null,seenMask=0,firstSkip:string|null=null
 return{
  native(id:unknown){
   if(typeof id!=='string'||id.length>40)return
   const f=/^D476_OBS788_FG_([LA])_([01])_([X0-5])$/.exec(id)
   if(f&&f[0]===id){const value={activationReturned:f[2]==='1',focusSucceeded:f[3]!=='X',relation:f[3]==='X'?'NOT_READ':relations[Number(f[3])]};if(f[1]==='L'){local??=value}else archive??=value;return}
   const stage=/^D476_OBS788_T_([1-9]|10)$/.exec(id)
   if(stage&&stage[0]===id){seenMask|=1<<(Number(stage[1])-1);return}
   const skip=/^D476_OBS788_SKIP_([V0-5])$/.exec(id)
   if(skip&&skip[0]===id&&firstSkip===null)firstSkip=skip[1]==='V'?'NOT_VISIBLE':relations[Number(skip[1])]
  },
  snapshot(){return{schema:1,local:local?{...local}:null,archive:archive?{...archive}:null,terminal:{seenMask,firstSkip}}},
 }
}
