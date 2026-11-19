// Inspect executable shell only: file triggers and job labels are not commands.
export function workflowRunBlocks(workflow) {
 const lines=workflow.split('\n'),blocks=[];
 for(let i=0;i<lines.length;i++) {
  const match=/^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[i]);
  if(!match)continue;
  if(/^[|>][-+]?\s*(?:#.*)?$/.test(match[2])) {
   const body=[],indent=match[1].length+(lines[i].trimStart().startsWith('- ')?2:0);
   while(i+1<lines.length&&(!lines[i+1].trim()||/^\s*/.exec(lines[i+1])[0].length>indent))body.push(lines[++i]);
   blocks.push(body.join('\n'));
  } else blocks.push(match[2]);
 }
 return blocks.join('\n');
}
