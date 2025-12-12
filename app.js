const el=(id)=>document.getElementById(id);
const state={bodySn:null,pcbId:null,stream:null,track:null,torchOn:false,busy:false};
const settings={snDigits:8,gasUrl:"",resolution:"1280x720"};

function loadSettings(){
  try{
    const s=JSON.parse(localStorage.getItem("ocr_linker_settings")||"{}");
    if(s.snDigits) settings.snDigits=Number(s.snDigits);
    if(s.gasUrl) settings.gasUrl=String(s.gasUrl);
    if(s.resolution) settings.resolution=String(s.resolution);
  }catch(_){}
  el("snDigits").value=settings.snDigits;
  el("gasUrl").value=settings.gasUrl;
  el("resolution").value=settings.resolution;
}
function saveSettings(){
  settings.snDigits=Number(el("snDigits").value||8);
  settings.gasUrl=String(el("gasUrl").value||"").trim();
  settings.resolution=String(el("resolution").value||"1280x720");
  localStorage.setItem("ocr_linker_settings",JSON.stringify(settings));
  toast("設定を保存しました。",true);
  updateSaveEnabled();
}
function toast(msg,ok=null){
  const box=el("saveStatus");
  box.textContent=msg;
  box.className="status"+(ok===true?" ok":ok===false?" bad":"");
}
function setWarn(target,msg){ el(target).textContent=msg||""; }
function setValue(target,msg){ el(target).textContent=msg||"—"; }
function updateSaveEnabled(){
  const ready=!!state.bodySn && !!state.pcbId && !!settings.gasUrl;
  el("btnSave").disabled=!ready || state.busy;
}

async function startCamera(){
  if(state.stream) return;
  const [w,h]=settings.resolution.split("x").map(n=>Number(n));
  const c1={audio:false,video:{facingMode:{ideal:"environment"},width:{ideal:w},height:{ideal:h}}};
  const c2={audio:false,video:{width:{ideal:w},height:{ideal:h}}};
  const c3={audio:false,video:true};
  try{
    state.stream=await navigator.mediaDevices.getUserMedia(c1)
      .catch(()=>navigator.mediaDevices.getUserMedia(c2))
      .catch(()=>navigator.mediaDevices.getUserMedia(c3));
    el("video").srcObject=state.stream;
    el("video").setAttribute("playsinline","true");
    await el("video").play();
    state.track=state.stream.getVideoTracks()[0];
    el("btnTorch").disabled=!(state.track.getCapabilities && state.track.getCapabilities().torch);
    toast("カメラを開始しました。");
  }catch(err){
    console.error(err);
    toast("カメラを開始できません。Safariの権限設定をご確認ください。",false);
  }
}
function stopCamera(){
  if(!state.stream) return;
  state.stream.getTracks().forEach(t=>t.stop());
  state.stream=null; state.track=null;
  el("video").srcObject=null;
  el("btnTorch").disabled=true;
  state.torchOn=false;
  toast("カメラを停止しました。");
}
async function toggleTorch(){
  if(!state.track) return;
  const caps=state.track.getCapabilities?state.track.getCapabilities():{};
  if(!caps.torch) return;
  state.torchOn=!state.torchOn;
  try{
    await state.track.applyConstraints({advanced:[{torch:state.torchOn}]});
    toast(state.torchOn?"フラッシュ ON":"フラッシュ OFF");
  }catch(err){
    console.error(err);
    toast("フラッシュ制御に失敗しました。",false);
  }
}
function captureFrame(){
  const video=el("video");
  if(!video.videoWidth) throw new Error("video not ready");
  const canvas=el("canvas");
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  const vw=video.videoWidth, vh=video.videoHeight;
  const cropW=Math.floor(vw*0.88);
  const cropH=Math.floor(vh*0.32);
  const sx=Math.floor((vw-cropW)/2);
  const sy=Math.floor((vh-cropH)/2);
  canvas.width=cropW; canvas.height=cropH;
  ctx.drawImage(video,sx,sy,cropW,cropH,0,0,cropW,cropH);
  return canvas;
}
function normalizeText(t){
  return (t||"").replace(/\s+/g," ").trim()
    .replace(/SN\s*[:：]\s*/gi,"SN:")
    .replace(/S\s*N\s*[:：]/gi,"SN:")
    .replace(/O/g,"0").replace(/I/g,"1").replace(/l/g,"1");
}
function extractSn(text,digits){
  const re=new RegExp(`SN:\\s*([0-9]{${digits}})`,"i");
  const m=text.match(re);
  return m?`SN:${m[1]}`:null;
}
function extractPcb(text){
  const re=/\b(PCB-[A-Z0-9]{2,12}(?:-[A-Z0-9]{2,12}){1,3})\b/i;
  const m=text.match(re);
  return m?m[1].toUpperCase():null;
}
async function runOcrAndExtract(mode){
  if(state.busy) return;
  state.busy=true; updateSaveEnabled();
  try{
    await startCamera();
    const canvas=captureFrame();
    toast("OCR中…（数秒かかることがあります）");
    const {data}=await Tesseract.recognize(canvas,"eng",{});
    const text=normalizeText(data.text||"");
    if(mode==="body"){
      const sn=extractSn(text,settings.snDigits);
      if(!sn){
        setWarn("bodyWarn",`SNが見つかりません。『SN:${"0".repeat(settings.snDigits)}』形式で枠内に入れてください。`);
        toast("本体SNの抽出に失敗しました。撮り直してください。",false);
      }else{
        state.bodySn=sn.toUpperCase(); setValue("bodySn",state.bodySn); setWarn("bodyWarn","");
        toast("本体SNを取得しました。",true);
      }
    }else{
      const pcb=extractPcb(text);
      if(!pcb){
        setWarn("pcbWarn","基板番号が見つかりません。表記ルールを確認して枠内に入れてください。");
        toast("基板番号の抽出に失敗しました。撮り直してください。",false);
      }else{
        state.pcbId=pcb; setValue("pcbId",state.pcbId); setWarn("pcbWarn","");
        toast("基板番号を取得しました。",true);
      }
    }
  }catch(err){
    console.error(err);
    toast("OCR処理でエラーが発生しました。",false);
  }finally{
    state.busy=false; updateSaveEnabled();
  }
}
function clearBody(){ state.bodySn=null; setValue("bodySn","—"); setWarn("bodyWarn",""); updateSaveEnabled(); }
function clearPcb(){ state.pcbId=null; setValue("pcbId","—"); setWarn("pcbWarn",""); updateSaveEnabled(); }
function resetAll(){
  clearBody(); clearPcb();
  el("workType").value="組立";
  el("operator").value="";
  el("note").value="";
  toast("リセットしました。");
}
async function saveLink(){
  if(state.busy) return;
  if(!settings.gasUrl){ toast("設定でGAS Webhook URLを入れてください。",false); return; }
  if(!state.bodySn || !state.pcbId){ toast("本体SNと基板番号を取得してください。",false); return; }
  state.busy=true; updateSaveEnabled();
  const payload={
    ts:new Date().toISOString(),
    body_sn:state.bodySn,
    pcb_id:state.pcbId,
    work_type:String(el("workType").value||""),
    operator:String(el("operator").value||"").trim(),
    note:String(el("note").value||"").trim(),
    user_agent:navigator.userAgent,
  };
  try{
    toast("保存中…");
    const res=await fetch(settings.gasUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const txt=await res.text();
    if(!res.ok){ console.error(txt); toast("保存に失敗しました（GAS側をご確認ください）",false); return; }
    toast("保存しました（紐づけ完了）",true);
  }catch(err){
    console.error(err);
    toast("通信エラーで保存できませんでした。",false);
  }finally{
    state.busy=false; updateSaveEnabled();
  }
}
function wire(){
  el("btnStartCam").addEventListener("click",startCamera);
  el("btnStopCam").addEventListener("click",stopCamera);
  el("btnTorch").addEventListener("click",toggleTorch);
  el("btnCaptureBody").addEventListener("click",()=>runOcrAndExtract("body"));
  el("btnCapturePcb").addEventListener("click",()=>runOcrAndExtract("pcb"));
  el("btnClearBody").addEventListener("click",clearBody);
  el("btnClearPcb").addEventListener("click",clearPcb);
  el("btnResetAll").addEventListener("click",resetAll);
  el("btnSave").addEventListener("click",saveLink);
  el("btnSaveSettings").addEventListener("click",saveSettings);
  el("resolution").addEventListener("change",async ()=>{ settings.resolution=el("resolution").value; saveSettings(); stopCamera(); await startCamera(); });
  loadSettings(); updateSaveEnabled();
  toast("準備OK。まず「設定」でGAS URLを入れてください。");
}
window.addEventListener("load",wire);
