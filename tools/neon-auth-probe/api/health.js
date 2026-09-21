export default function handler(_request,response){
  response.status(200).json({ok:true,probe:'pack1-neon-auth'});
}
