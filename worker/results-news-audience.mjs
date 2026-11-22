// Owner-only aggregate for a new Pack One news campaign approved now.
// This report never returns or logs addresses, identifiers, or recipient lists.
// The actual sender still rechecks every account immediately before handoff.
import {resultsEmailHash} from './results-privacy.mjs';

const PAGE_SIZE=250;
const MAX_AUDIENCE_SCAN=5000;
const isTrue=value=>value===true||value==='t'||value==='true'||value===1;
const emptyBreakdown=()=>({eligible:0,deleting:0,doNotContact:0,unverified:0,consentNotReady:0,addressChanged:0,suppressed:0});

export async function newsAudienceSnapshot(query,{env=process.env}={}){
  const aggregate=(await query(`SELECT
    count(*) FILTER(WHERE p.news_email_state='on')::int opted_in,
    count(*) FILTER(WHERE p.news_email_state='off')::int opted_out,
    count(*) FILTER(WHERE coalesce(p.news_email_state,'unanswered')='unanswered')::int unanswered
    FROM neon_auth."user" u LEFT JOIN results_preferences p ON p.auth_user_id=u.id`)).rows[0]||{};
  const optedIn=Number(aggregate.opted_in||0);
  const counts=emptyBreakdown();
  const base={asOf:new Date().toISOString(),optedIn,optedOut:Number(aggregate.opted_out||0),
    unanswered:Number(aggregate.unanswered||0)};
  if(optedIn>MAX_AUDIENCE_SCAN)
    return {...base,complete:false,reason:'too_many_subscribers',...Object.fromEntries(Object.keys(counts).map(k=>[k,null]))};

  let cursor=null,scanned=0;
  // Keyset pages avoid an unbounded email query or a list returned to the browser.
  // Emails exist only in the authenticated worker while matching the current
  // destination to the HMAC fingerprint stored at consent time.
  do {
    const rows=(await query(`SELECT p.auth_user_id,u.email,u."emailVerified" verified,
      p.destination_hash,
      (p.do_not_contact_at IS NOT NULL) do_not_contact,
      (p.news_changed_at<=now() AND u."createdAt"<=now()) consent_ready,
      EXISTS(SELECT 1 FROM account_deletion_operations d WHERE d.auth_user_id=p.auth_user_id) deleting,
      (EXISTS(SELECT 1 FROM results_email_suppressions s WHERE s.auth_user_id=p.auth_user_id
        AND s.destination_hash=p.destination_hash)
       OR EXISTS(SELECT 1 FROM daily_reminder_email_suppressions s WHERE s.auth_user_id=p.auth_user_id
        AND s.destination_hash=p.destination_hash)) suppressed
      FROM results_preferences p JOIN neon_auth."user" u ON u.id=p.auth_user_id
      WHERE p.news_email_state='on' AND ($1::uuid IS NULL OR p.auth_user_id>$1::uuid)
      ORDER BY p.auth_user_id LIMIT $2::int`,[cursor,PAGE_SIZE])).rows;
    for(const row of rows){
      if(isTrue(row.deleting))counts.deleting++;
      else if(isTrue(row.do_not_contact))counts.doNotContact++;
      else if(!isTrue(row.verified)||!row.email)counts.unverified++;
      else if(!isTrue(row.consent_ready))counts.consentNotReady++;
      else if(!row.destination_hash||resultsEmailHash(row.email,env)!==row.destination_hash)counts.addressChanged++;
      else if(isTrue(row.suppressed))counts.suppressed++;
      else counts.eligible++;
    }
    scanned+=rows.length;
    if(scanned>MAX_AUDIENCE_SCAN)return {...base,complete:false,reason:'scan_limit',...Object.fromEntries(Object.keys(counts).map(k=>[k,null]))};
    if(rows.length<PAGE_SIZE)break;
    cursor=rows.at(-1).auth_user_id;
  }while(scanned<MAX_AUDIENCE_SCAN+PAGE_SIZE);

  // If preferences changed while pages were read, avoid a misleading exact count.
  if(scanned!==optedIn)return {...base,complete:false,reason:'changed_during_count',...Object.fromEntries(Object.keys(counts).map(k=>[k,null]))};
  return {...base,complete:true,...counts};
}
