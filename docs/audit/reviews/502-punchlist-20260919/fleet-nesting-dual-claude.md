The output file is locked (EPERM on rename 鈥?likely held open by the orchestrator), so the review stays here in-chat; it's untracked and empty, nothing was modified.

---

# 鑸伴槦宓屽 路 璁捐澶嶅锛坈laude 鑷傦級

杈撳叆锛歜rief + `thread-timeline.ts roleBadge` + `ThreadList.tsx renderThreadRow(~965)` + `FleetWorkerList.tsx` + spec 搂6 鍒囩墖 E銆傚彧瑁佽璁★紝涓嶅疄鐜般€?
## 1. 浜嬫晠钀藉湴锛?r2frm锛夆€斺€旀満鍒舵垚绔?
- `spawn_worker` 浜у嚭鐪?ADR-015 thread锛岀粡 `thread.list` 鍏ㄩ噺杩?`state.threads`銆?- `filtered`锛圱hreadList.tsx:391-396锛夊彧婊?trashed + query锛?*鏃犱换浣?`agent_role` 鍒嗘祦**銆?- `renderThreadRow`锛圱hreadList.tsx:965锛夊鎵€鏈?thread 涓€瑙嗗悓浠侊紱鍞竴韬唤绾跨储鏄?`roleBadge` 鐨勮嫳鏂囧皬寰界珷 `"worker"`/`"orch"`锛坱hread-timeline.ts:420-424锛夆€斺€旀棤鍒嗙粍銆佹棤鐖堕摼鎺ャ€佹棤璁℃暟銆?- worker 閫氬父鏃?alias 鈫?`displayThreadTitle`锛坱hread-timeline.ts:316锛夎惤鍒?`first_user_preview`锛? spawn 绠€鎶ュ彞锛夋垨鐭?id銆?86ryj / z1p2kd / mpvmhf 灏辨槸 `formatThreadIdBadge` 缂栧彿鈥斺€斾笁琛岀煭 id锛岄暱寰楀拰鏅€氬璇濅竴鏍枫€?
浜у搧鍏堜緥浣愯瘉锛氭竻鐞?`include_workers: false`锛圱hreadList.tsx:874锛夈€佹壒閲忔娊鍙?`excludeWorkers: true`锛?428锛夈€両nspect 鍙湅涓嶅垏绾跨▼銆備骇鍝佸凡鍦ㄤ笁澶勬壙璁?worker 涓嶆槸鏅€氬巻鍙测€斺€?*鍒楄〃骞崇骇灞曠ず鏄敮涓€渚嬪**銆傜畝鎶ョ幇鐘舵弿杩板叏閮ㄦ牳瀹炴棤璇€?
## 2. 鏀诲嚮绠€鎶?
**A1锛堟渶閲嶈锛夋柟妗?A 鍐欑獎浜嗐€?* 骞崇骇瀵硅瘽 bug 涓嶆鍦?ThreadList锛歚WorkspaceFrame.tsx:50`锛?497 瀹藉睆瀵艰埅銆屾渶杩戝璇濄€嶏級鍜?`AtThreadPopover.tsx:38`锛園 寮曠敤浼氳瘽锛夐兘鏄?*鏃?agent_role 杩囨护鐨勫叏閲忔睜**锛沗thread_graph.open`锛?477-494锛夌殑鍥捐氨鑺傜偣褰掑睘绠€鎶ヤ篃娌℃彁銆傚彧鏀?ThreadList锛屼簨鏁呭湪 鈮?60px 鍘熸牱澶嶅彂銆備慨姝ｈ姹傦細鏀硅堪涓恒€寃orker 琛岄粯璁や笉杩涗换浣?*瀵硅瘽鏋氫妇闈?*銆嶏紝璋撹瘝锛坄isFleetWorkerThread`锛夋敹鏁涗负涓€涓叡浜伐鍏凤紝涓夊鍚岀敤銆?*蹇呴』鍚告敹椤广€?*

**A2 銆? 瀛愪换鍔°€嶈鏁版病閽?SoT銆?* `state.fleet.workers` 鏉ヨ嚜 `fleet.status` 杞锛宑ompanion 閲嶅惎 / reload 鍚庝负绌衡€斺€旀寜蹇収璁℃暟锛岄噸鍚悗鐖惰寰界珷娑堝け鑰屼笁琛?worker 杩樺湪锛屽垪琛ㄥ啀鎾掕皫涓€娆★紙#502 D 鎵圭殑閭ｇ被锛夈€傝鏁?SoT 蹇呴』鏄?*鎸佷箙 thread 鍥?*锛坄parent_thread_id` / `orchestrator_run_id`锛宼ypes.ts:60-62 瀛楁榻愬叏锛夛紝娲绘€х偣鎵嶄粠蹇収鍙犲姞銆?
**A3 璋撹瘝涓夌被璞佸厤锛屽惁鍒?Q4 涓ゆ潯 BLOCK 瑙ｉ櫎涓嶄簡銆?* 鈶?orchestrator 姘镐笉闅愶紙璋撹瘝鍐欐 `=== "worker"`锛夛紱鈶?鐖堕摼鎺ユ偓绌虹殑瀛ゅ効 worker 涓嶉殣锛堥暅鍍?`resolveFleetScope` 鐨?parent 鍏滃簳锛宼hread-busy.ts:152锛夛紝鍚﹀垯鏁版嵁婕傜Щ鍚庨櫎鍥捐氨澶栨棤鍏ュ彛锛涒憿 `user_message_count > 0` 鐨?worker 涓嶉殣锛坄displayThreadTitle` 宸插湪鐢ㄨ淇″彿锛夆€斺€旂敤鎴蜂翰鎵嬪彂瑷€杩囩殑灏辨槸鐢ㄦ埛浜х墿锛屻€屽璇濅紭鍏堛€嶄笉璇ュ悶瀹冦€?
**A4 active 琛屾亽鏄俱€?* 杩涘叆瀛愪换鍔″悗鎵撳紑鍘嗗彶闈㈡澘锛岃嫢 active 鐨?worker 琛岃闅愯棌锛屽垪琛ㄩ噷娌℃湁銆屼綘姝ｅ湪鍏朵腑銆嶁€斺€旇繖涓皫姣斿钩绾у睍绀烘洿浼ゃ€傚姞 `t.id === activeThreadId` 渚嬪锛汼tatusRail 闈㈠寘灞戠鏂瑰悜锛屽垪琛ㄩ珮浜浣嶇疆銆?
**A5 銆屽凡瀹屾垚銆嶆病鏈変俊鍙锋簮銆?* FleetWorkerView 鍙湁 idle/holding_tabs/paused + llm_active锛沬dle 涓嶇┖杞?鈮?骞插畬浜嗐€倂1 寰界珷 = `N 瀛愪换鍔 + busy 娲荤偣锛岀爫鎺夈€屽凡瀹屾垚銆嶅悗缂€锛岀瓑鐪?outcome 淇″彿鍐嶄笂銆?
**A6 寰界珷鐐瑰嚮鏈?scope 闄烽槺銆?* FleetWorkerList 鐨?scope 鍙栬嚜 `state.activeThreadId`锛團leetWorkerList.tsx:41-62锛夛紱浠庨潪 active 鐖惰鐐瑰窘绔犱細寮€閿欏垪琛ㄣ€傜邯寰嬶細鍏?`thread.select` 鐖剁嚎绋嬶紝鍐?`SET_FLEET_LIST_OPEN`銆?
**A7 鎼滅储涓や釜缁嗚妭銆?* `filterThreadsByQuery` 宸插惈 `id.includes(q)`鈥斺€旂矘璐?286ryj 瀹氫綅蹇呴』缁х画鍛戒腑琚殣钘忕殑琛岋紙闅愯棌琛?= 鎼滅储鍙琛岋紝鍚屼竴姹犲瓙锛夛紱銆屽睘浜庛€屾湭鍛藉悕銆嶃€嶆槸鐖舵爣棰樺厹搴曡€岄潪缂哄け锛屽啓鏄庡嵆鍙€?
**A8 鏂规 B 鍚﹀喅鐞嗙敱绔欎笉浣忥紝缁撹涓嶅彉銆?* Glance 鏄椿鎬с€佸垪琛ㄦ槸鍘嗗彶锛屽畬宸ュ悗 portal 娓呯┖鑰屽巻鍙蹭粛鍦ㄢ€斺€斻€岄噸澶嶃€嶄笉鎴愮珛銆侭 鐪熸鍥犳槸 320px 瀵嗗害 + 姣忕埗琛屾柊澧炲睍寮€鎬?state銆備粛閫?A銆?
## 3. 鍥涢棶瑁佸喅

1. **鏂规 A 姝ｇ‘鍚?* 鈥斺€?姝ｇ‘锛屽甫鍥涙潯淇锛氫笁闈㈠悓鍒?+ 鍏变韩璋撹瘝锛圓1锛屽繀椤伙級锛涜鏁?SoT = thread 鍥撅紙A2锛夛紱涓夌被璞佸厤 + active 鎭掓樉锛圓3/A4锛夛紱v1 鏃犮€屽凡瀹屾垚銆嶏紙A5锛夈€?2. **銆岃繘鍏ュ瓙浠诲姟銆嶄繚鐣?* 鈥斺€?淇濈暀锛?*涓嶈兘**鐮嶆垚 Inspect-only銆侷nspect 鏄洿鎾獥锛堢畝鎶?+ 鏈€杩戝伐鍏?+ 鏈疆 ~800 瀛楀熬锛宍WorkerInspectPanel` 涓嶅姞杞藉巻鍙诧級锛?*骞插畬鐨?worker 鍦?Inspect 閲屼粈涔堥兘娌℃湁**锛涜繘鍏?+ 鎼滅储鏄畬宸ュ瓙浠诲姟浠呮湁鐨勪袱鎵囬棬銆傞檷绾т负闈㈠寘灞?`鈫?涓讳换鍔 + `瀛愪换鍔?路 鏍囬` 鐨勫啓娉曞銆?3. **瀹屽伐 worker 浠庢悳绱㈣繘** 鈥斺€?蹇呴』鍙互銆傝瘉鎹 = `瀛愪换鍔?路 灞炰簬銆岀埗鏍囬銆峘锛屼繚鐣?id 寰界珷锛堢矘璐村畾浣嶉摼璺緷璧栵級锛汙 寮曠敤闈㈢户缁帓闄?worker銆?4. **BLOCK** 鈥斺€?涓ゆ潯鎴愮珛锛?*鑼冨洿灞?*锛堢幇鏂囧彧鐩?ThreadList锛?497 瀹藉睆瀵艰埅涓?@ 闈笉杩囨护锛屼簨鏁呮惉灞忊€斺€斾慨绠€鎶ユ枃瀛楀嵆瑙ｉ櫎锛夛紱**璋撹瘝灞?*锛堟棤 A3/A4 璞佸厤浼氳棌鐢ㄦ埛浜х墿涓庨褰扁€斺€斿甫璞佸厤鍗宠В闄わ級銆傝钘?orchestrator锛氳皳璇嶅啓姝诲嵆鏃犻闄┿€侼EVER 娓呭崟鍏ㄨ繃锛氭棤鏂?Tab銆佹棤 overlay 纭銆佹棤 vis 杩?320px銆両nspect 涓嶈浆鍙?stdout_tail銆佷笉鏀?spawn/L2/arm銆佷笉鏀瑰瓨鍌ㄣ€?
## 4. 缁撹

浜嬫晠鏈哄埗灞炲疄锛屼骇鍝佸彞涓?#502 E 涓夋。 IA 鑷唇锛屾柟鍚戦€夊浜嗐€傜己闄峰叏鍦?*鑼冨洿涓庤皳璇嶇殑瑙勬牸鍖?*锛圓1鈥揂5锛夛紝鍧囦负绠€鎶ユ枃瀛椾笌瀹炵幇绁ㄥ彲鍚告敹椤癸紝涓嶅姩鎽囨柟妗?A 鏈韩銆?
VERDICT: APPROVE_WITH_NITS
