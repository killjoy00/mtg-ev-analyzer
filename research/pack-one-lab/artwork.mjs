// Deterministic article artwork; all data comes from validated evidence.
// Logo is the actual Pack One brand-mark.svg, not a redrawn mark.
export const BRAND_MARK="<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1024\" height=\"1024\" viewBox=\"0 0 40 40\"><rect width=\"40\" height=\"40\" fill=\"#1e4d7a\"/><g fill=\"#fff\"><path transform=\"translate(10.609375 30.400000) scale(0.026000 -0.026000)\" d=\"M432 495Q432 405 384.5 350.0Q337 295 259 295H174Q169 295 169 290V12Q169 7 165.5 3.5Q162 0 157 0H65Q60 0 56.5 3.5Q53 7 53 12V689Q53 694 56.5 697.5Q60 701 65 701H253Q306 701 346.5 675.0Q387 649 409.5 602.0Q432 555 432 495ZM316 492Q316 542 293.5 571.5Q271 601 234 601H174Q169 601 169 596V391Q169 386 174 386H234Q271 386 293.5 414.5Q316 443 316 492Z\"/><path transform=\"translate(23.265625 17.744000) scale(0.012000 -0.012000)\" d=\"M70 0V119H208V486H89V577Q141 587 177.5 601.0Q214 615 247 635H355V119H474V0Z\"/></g></svg>";
export const BRAND_VERSION='pack-one-lab-blue-v1';
const BLUE='#1e4d7a',INK='#15395b',PALE='#e5edf4',PAPER='#f7f8fa',MUTED='#536776';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const count=n=>n.toLocaleString('en-US');
const labelFor=Object.freeze({'quick-hit':'Draft Note','draft-decision':'Draft Theory','format-comparison':'Format Deep Dive'});
export const editorialLabel=mode=>labelFor[mode]||'Draft Research';
function splitLine(value,max){
  const tokens=String(value).trim().split(/\s+/).flatMap(w=>w.length<=max?[w]:w.match(new RegExp('.{1,'+max+'}','gu'))||[]);
  const lines=[];let line='';
  for(const word of tokens){if(line&&line.length+1+word.length>max){lines.push(line);line=word;}else line+=(line?' ':'')+word;}
  if(line)lines.push(line);
  return lines;
}
const svg=(w,h,content,alt)=>'<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'" role="img"><title>'+esc(alt)+'</title>'+content+'</svg>';
const text=(x,y,content,{size=28,color=INK,bold=false,anchor='start',family='Source Sans 3, Arial, sans-serif'}={})=>'<text x="'+x+'" y="'+y+'" fill="'+color+'" font-family="'+family+'" font-size="'+size+'" font-weight="'+(bold?'700':'400')+'" text-anchor="'+anchor+'">'+esc(content)+'</text>';
const rect=(x,y,w,h,fill)=>'<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" fill="'+fill+'"/>';
const display='Barlow Condensed, Arial Narrow, Arial, sans-serif';
function logo(x,y,size){
  return '<svg x="'+x+'" y="'+y+'" width="'+size+'" height="'+size+'" viewBox="0 0 40 40">'+BRAND_MARK.replace(/^<svg[^>]+>/,'').replace(/<\/svg>$/,'')+'</svg>';
}
function header({dark=false,mode}){
  const ink=dark?'#ffffff':BLUE,sub=dark?'#c7dcef':MUTED;
  return logo(42,28,64)+text(122,58,'PACK ONE LAB',{size:37,bold:true,color:ink,family:display})+
    text(123,84,'Magic draft research',{size:23,color:sub})+text(918,58,editorialLabel(mode).toUpperCase(),{size:21,color:sub,bold:true,anchor:'end'});
}
function cover(title,mode,set,focus){
  const w=960,h=480,dark=mode!=='format-comparison',bg=dark?BLUE:PALE,ink=dark?'#ffffff':INK,sub=dark?'#d5e4f0':MUTED;
  let size=52,lines=splitLine(title,27);
  while(lines.length>3&&size>36){size-=4;lines=splitLine(title,Math.floor(1450/size));}
  if(lines.length>4)throw Error('lab-artwork-title');
  const y=mode==='quick-hit'?159:176;
  let content=rect(0,0,w,h,bg)+header({dark,mode})+rect(42,110,876,2,dark?'#7599bc':'#b9cad9');
  lines.forEach((line,i)=>{content+=text(42,y+i*(size+11),line,{size,bold:true,color:ink,family:display});});
  const footer=mode==='format-comparison'?'RECENT SETS':String(set).toUpperCase();
  // Give long set names their own wrapped footer, never squeeze against URL.
  const footLines=splitLine(footer,45);
  if(footLines.length>2)throw Error('lab-artwork-set');
  if(mode==='quick-hit'&&focus.length>=2&&lines.length<=3){
    const a=focus[0],b=focus[1];
    const left=a.label.split(' — '),right=b.label.split(' — ');
    const caption=(left.length===2&&right.length===2&&left[1]===right[1]?left[1]+' · '+left[0]+' / '+right[0]:a.label+' / '+b.label);
    if(left.length===2&&right.length===2&&left[1]===right[1]&&caption.length<=65){
      content+=text(42,335,caption.toUpperCase(),{size:21,color:sub,bold:true});
      content+=text(42,386,a.percent.toFixed(1)+'%  /  '+b.percent.toFixed(1)+'%',{size:49,bold:true,color:ink,family:display});
    }else if(a.label.length<=30&&b.label.length<=30){
      [a,b].forEach((m,i)=>{
        const x=42+i*440;
        content+=text(x,335,m.label,{size:21,color:sub,bold:true});
        content+=text(x,386,m.percent.toFixed(1)+'%',{size:49,bold:true,color:ink,family:display});
      });
    }
  }else if(['draft-decision','quick-hit'].includes(mode)&&focus.length===1&&lines.length<=3){
    if(focus[0].label.length<=65){
      content+=text(42,335,focus[0].label.toUpperCase(),{size:21,color:sub,bold:true});
      content+=text(42,386,focus[0].percent.toFixed(1)+'%',{size:49,bold:true,color:ink,family:display});
    }
  }else if(mode==='format-comparison'&&focus.length<=3&&lines.length<=3&&focus.every(m=>m.label.length<=24)){
    focus.forEach((m,i)=>{
      const x=42+i*292;
      content+=text(x,373,m.percent.toFixed(1)+'%',{size:43,bold:true,color:ink,family:display});
      content+=text(x,404,m.label,{size:20,color:sub,bold:true});
    });
  }
  footLines.forEach((line,i)=>{content+=text(42,426+i*24,line,{size:20,bold:true,color:sub});});
  content+=text(918,450,'packone.pro',{size:23,color:ink,anchor:'end'});
  return svg(w,h,content,title+' — Pack One Lab');
}
function chart(focus,heading){
  const w=960,row=144,h=132+focus.length*row;
  let content=rect(0,0,w,h,PAPER)+logo(36,24,48)+text(100,56,'PACK ONE LAB',{size:30,bold:true,family:display})+
    text(924,56,heading.toUpperCase(),{size:21,color:MUTED,bold:true,anchor:'end'});
  focus.forEach((m,i)=>{
    const y=110+i*row;
    const lines=splitLine(m.label,44);
    if(lines.length>2)throw Error('lab-artwork-label');
    lines.forEach((line,j)=>{content+=text(36,y+j*29,line,{size:27,bold:true});});
    content+=text(924,y+7,m.percent.toFixed(1)+'%',{size:39,bold:true,anchor:'end',family:display});
    content+=rect(36,y+44,888,19,'#dce5ed')+rect(36,y+44,888*m.percent/100,19,BLUE);
    content+=text(36,y+89,count(m.numerator)+' of '+count(m.denominator)+' qualifying observations',{size:22,color:MUTED});
  });
  return svg(w,h,content,focus.map(m=>m.label+': '+m.percent.toFixed(1)+'% ('+count(m.numerator)+' of '+count(m.denominator)+')').join('; '));
}
export function articleArtwork({title,set,mode,metrics,chartHeading='Observed rates'}){
  if(typeof chartHeading!=='string'||!chartHeading.trim()||chartHeading.length>38)throw Error('lab-artwork-heading');
  if(!Array.isArray(metrics)||metrics.length<1||metrics.length>4||metrics.some(m=>!Number.isFinite(m.percent)||m.percent<0||m.percent>100||!Number.isSafeInteger(m.numerator)||!Number.isSafeInteger(m.denominator)||m.denominator<1||m.numerator<0||m.numerator>m.denominator))throw Error('lab-artwork-metrics');
  return {version:BRAND_VERSION,cover_svg:cover(title,mode,set,metrics),chart_svg:chart(metrics,chartHeading),
    chart_alt:metrics.map(m=>m.label+': '+m.percent.toFixed(1)+'% ('+count(m.numerator)+' of '+count(m.denominator)+')').join('; ')};
}
