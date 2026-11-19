// Test-only wire adapter. Production workers still use their actual SQL HTTP
// protocol; the fixture executes those SQL statements on a real local server.
import pg from 'pg';
export const SQL_CONNECTION='postgresql://fixture:fixture@ep-ci.us-east-2.aws.neon.tech/pack1';
export function fixturePool(connection=process.env.PACK1_TEST_DATABASE_URL) {
  const db=new URL(connection);
  if(!['postgres:','postgresql:'].includes(db.protocol)||!['localhost','127.0.0.1','[::1]'].includes(db.hostname)||db.pathname!=='/pack1'||db.username!=='pack1_ci')throw Error('Database fixtures require a local pack1 database owned by the pack1_ci test role');
  return new pg.Pool({connectionString:connection,max:8,connectionTimeoutMillis:5000,statement_timeout:30000});
}
export const textTypes={getTypeParser:()=>value=>value};
export function postgresTransport(pool) {
  return async function fetchSQL(url,options={}) {
    const headers=new Headers(options.headers);
    if(String(url)!=='https://api.us-east-2.aws.neon.tech/sql'||options.method!=='POST'||headers.get('Neon-Connection-String')!==SQL_CONNECTION)throw Error('Unexpected external call in PostgreSQL fixture');
    const {query,params=[]}=JSON.parse(options.body);
    try {
      const result=await pool.query({text:query,values:params,rowMode:'array',types:textTypes});
      const fields=result.fields.map(field=>({name:field.name,dataTypeID:field.dataTypeID}));
      const rows=headers.get('Neon-Array-Mode')==='true'?result.rows:result.rows.map(row=>Object.fromEntries(fields.map((field,i)=>[field.name,row[i]])));
      return Response.json({fields,rows,rowCount:result.rowCount});
    } catch(error) {
      return Response.json({code:error.code,message:error.message,detail:error.detail},{status:400});
    }
  };
}
