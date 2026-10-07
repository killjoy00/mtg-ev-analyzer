// Neon executes each /sql query in an implicit transaction. These SQLSTATEs
// prove that transaction was rolled back; transport failures do not, and must
// never cause a mutation retry. Caller-supplied parameters stay unchanged.
export async function retryRolledBackQuery(operation,{sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),attempts=5}={}) {
  for(let attempt=0;;attempt++) {
    try {return await operation();}
    catch(error) {
      if(!['40001','40P01'].includes(error?.pgCode)||attempt+1>=attempts)throw error;
      await sleep(25*(attempt+1));
    }
  }
}
