// Usage: node scripts/repair_card_backend_image.mjs BASE_URL [--verify]
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {importRequest} from './actions-import-auth.mjs';

const DEFAULT_REPORT='generated/card-image-repair/report.json';

function validatePage(page,setId) {
  if(
    page?.set_id!==setId||
    Number(page.mapping_entries)!==1||
    !Number.isInteger(Number(page.puzzles))||
    Number(page.puzzles)<0||
    !Number.isInteger(Number(page.updated_puzzles))||
    Number(page.updated_puzzles)<0||
    !Number.isInteger(Number(page.updated_cards))||
    Number(page.updated_cards)<0||
    typeof page.done!=='boolean'
  )throw new Error(`Unexpected targeted image refresh response for ${setId}`);
}

function parseRepairReport(report) {
  const setIds=report?.environments;
  if(!Array.isArray(setIds)||!setIds.length||setIds.length>8||new Set(setIds).size!==setIds.length)
    throw new Error('Targeted repair report has invalid environments.');
  const mappings=new Map();
  for(const setId of setIds) {
    if(typeof setId!=='string'||!setId||setId.length>100)
      throw new Error('Targeted repair report has invalid environment id.');
    const mapping=report?.environment_results?.[setId]?.mapping;
    if(
      !mapping||
      typeof mapping!=='object'||
      Array.isArray(mapping)||
      typeof mapping.name!=='string'||
      !mapping.name||
      typeof mapping.image_url!=='string'||
      !mapping.image_url.startsWith('https://')
    )throw new Error(`Invalid targeted image mapping for ${setId}`);
    mappings.set(setId,[mapping]);
  }
  return {setIds,mappings};
}

export function readRepairReport(reportPath=DEFAULT_REPORT) {
  return parseRepairReport(JSON.parse(fs.readFileSync(reportPath,'utf8')));
}

export function writeBackendDiagnostics(outputPath,payload) {
  if(!outputPath)return;
  fs.mkdirSync(path.dirname(outputPath),{recursive:true});
  fs.writeFileSync(outputPath,JSON.stringify(payload,null,2)+'\n','utf8');
}

export async function repairBackendImages(
  base,
  {reportPath=DEFAULT_REPORT,report=null,request=importRequest,verify=false,onProgress=null}={},
) {
  if(!base?.startsWith('https://'))throw new Error('A HTTPS Draft Run API base URL is required.');
  const parsed=report?parseRepairReport(report):readRepairReport(reportPath);
  const refreshed=[];
  for(const setId of parsed.setIds) {
    const mapping=parsed.mappings.get(setId);
    if(!Array.isArray(mapping)||mapping.length!==1)
      throw new Error(`Targeted image mapping must contain exactly one entry for ${setId}`);
    let after='',puzzles=0,updatedPuzzles=0,updatedCards=0,pages=0;
    for(;;) {
      const page=await request(base,{action:'refresh-image-page',setId,mapping,after});
      validatePage(page,setId);
      pages+=1;
      if(verify&&Number(page.updated_cards)!==0)
        throw new Error(`Targeted image verification found ${page.updated_cards} updates for ${setId}`);
      puzzles+=Number(page.puzzles);
      updatedPuzzles+=Number(page.updated_puzzles);
      updatedCards+=Number(page.updated_cards);
      const pageResult={
        phase:'page',
        set_id:setId,
        verify,
        page:pages,
        page_puzzles:Number(page.puzzles),
        puzzles,
        updated_puzzles:updatedPuzzles,
        updated_cards:updatedCards,
        done:page.done,
      };
      console.log(JSON.stringify(pageResult));
      if(onProgress)onProgress(pageResult);
      if(page.done)break;
      if(typeof page.next_after!=='string'||!page.next_after||page.next_after===after)
        throw new Error(`Targeted image refresh cursor did not advance for ${setId}`);
      after=page.next_after;
    }
    if(puzzles<1)throw new Error(`No verified puzzles are available for targeted image refresh: ${setId}`);
    const summary={
      set_id:setId,
      mapping_entries:1,
      pages,
      puzzles,
      updated_puzzles:updatedPuzzles,
      updated_cards:updatedCards,
      verified_zero_updates:verify?updatedCards===0:null,
      marker_normalized:false,
    };

    if(!verify) {
      const result=await request(base,{action:'normalize-image-markers',setIds:[setId]});
      const items=result?.normalized||[];
      if(
        items.length!==1||
        items[0]?.set_id!==setId||
        Number(items[0].missing_images)!==0||
        Number(items[0].puzzles)<1
      )throw new Error(`Unexpected targeted image-marker normalization response for ${setId}`);
      summary.marker_normalized=true;
      if(onProgress)onProgress({
        phase:'normalize-image-markers',
        set_id:setId,
        puzzles:Number(items[0].puzzles),
        missing_images:Number(items[0].missing_images),
      });
    }
    refreshed.push(summary);
  }
  return refreshed;
}

export async function runBackendRepair(
  base,
  {
    reportPath=DEFAULT_REPORT,
    report=null,
    request=importRequest,
    verify=false,
    diagnosticsPath='',
    stage='',
  }={},
) {
  const events=[];
  try {
    const results=await repairBackendImages(base,{
      reportPath,
      report,
      request,
      verify,
      onProgress:event=>events.push(event),
    });
    writeBackendDiagnostics(diagnosticsPath,{
      stage,
      verify,
      status:'success',
      results,
      events,
    });
    return results;
  } catch(error) {
    writeBackendDiagnostics(diagnosticsPath,{
      stage,
      verify,
      status:'error',
      error:error instanceof Error?error.message:String(error),
      events,
    });
    throw error;
  }
}

async function main(argv=process.argv.slice(2)) {
  const base=argv[0];
  const verify=argv.includes('--verify');
  if(argv.some((value,index)=>index>0&&value!=='--verify'))
    throw new Error('Usage: repair_card_backend_image.mjs BASE_URL [--verify]');
  await runBackendRepair(base,{
    verify,
    diagnosticsPath:process.env.CARD_IMAGE_BACKEND_DIAGNOSTICS||'',
    stage:process.env.CARD_IMAGE_BACKEND_STAGE||'',
  });
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)await main();
