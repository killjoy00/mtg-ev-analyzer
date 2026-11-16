import {useCallback,useRef,useState} from 'react';
import {useFocusEffect,router} from 'expo-router';
import {Pressable,StyleSheet,View} from 'react-native';
import {Text} from '@/src/components/Text';
import {resultsRequest,type ResultsSnapshot} from '@/src/api/results';
import {readSession,subscribeSession,type MobileSession} from '@/src/storage/session';
import {resultsCopy as copy} from '@/src/resultsCopy';
import {colors,spacing} from '@/src/theme';

export function ResultsPreferences({settings=false}:{settings?:boolean}){
 const [state,setState]=useState<ResultsSnapshot|null>(null);
 const [kind,setKind]=useState<'prompt'|'notice'|null>(null);
 const [message,setMessage]=useState(''),[saving,setSaving]=useState(false);
 const owner=useRef<MobileSession|null>(null),generation=useRef(0);
 useFocusEffect(useCallback(()=>{
  let active=true;
  const load=async()=>{
   let launched=false;
   const version=++generation.current;setState(null);setKind(null);setMessage('');setSaving(false);owner.current=null;
   try{
    const session=await readSession();if(!session?.accountToken||!active||version!==generation.current)return;
    owner.current=session;
    const snapshot=await resultsRequest(session);
    if(!active||version!==generation.current||!snapshot.active)return;
    launched=true;
    setState(snapshot);
    const shown=await resultsRequest(session,'present');
    if(active&&version===generation.current)setKind(shown.presentation||null);
   }catch{if(launched&&active&&version===generation.current&&settings)setMessage('Could not load results preferences.');}
  };
  void load();const unsubscribe=subscribeSession(()=>{void load();});
  return ()=>{active=false;generation.current++;owner.current=null;unsubscribe();};
 },[settings]));
 const save=async(action:string)=>{
  const session=owner.current,version=generation.current;if(!session)return;
  setSaving(true);setMessage('');
  try{const value=await resultsRequest(session,action);if(version!==generation.current)return;setState(value);if(/^(prompt|notice|settings):/.test(action))setKind(null);}
  catch(error){if(version===generation.current)setMessage(error instanceof Error?error.message:'Could not save this choice.');}
  finally{if(version===generation.current)setSaving(false);}
 };
 const button=(label:string,action:string,selected?:boolean)=><Pressable key={action} accessibilityRole="button" accessibilityState={{disabled:saving,...(selected===undefined?{}:{selected})}} disabled={saving} style={styles.button} onPress={()=>void save(action)}><Text style={styles.label}>{label}</Text></Pressable>;
 if(!state?.active)return settings&&message?<Text accessibilityRole="alert">{message}</Text>:null;
 return <View style={styles.section}>
  {kind?<View style={styles.section}>
   <Text style={styles.heading}>{kind==='prompt'?copy.promptTitle:copy.noticeTitle}</Text>
   {(kind==='prompt'?[copy.promptBody]:copy.noticeBody).map(p=><Text key={p} style={styles.body}>{p}</Text>)}
   <View style={styles.actions}>{button(kind==='prompt'?copy.yes:copy.noticeButton,kind==='prompt'?'prompt:on':'notice:on')}{button(kind==='prompt'?copy.no:'Dismiss',kind==='prompt'?'prompt:off':'notice:dismiss')}</View>
   <Text style={styles.body}>{kind==='prompt'?copy.promptFoot:copy.noticeFoot}</Text>
   {kind==='notice'?<View style={styles.actions}><Pressable accessibilityRole="link" onPress={()=>router.push('/privacy')}><Text>Privacy Policy</Text></Pressable><Text> · </Text><Pressable accessibilityRole="link" onPress={()=>router.push('/terms')}><Text>Terms</Text></Pressable></View>:null}
  </View>:null}
  {settings?<View style={styles.section}>
   <Text style={styles.heading}>{copy.emailTitle}</Text><Text style={styles.heading}>{copy.emailLabel}</Text><Text style={styles.body}>{copy.emailBody}</Text>
   <View style={styles.actions}>{button('On','settings:on',state.emailState==='on')}{button('Off','settings:off',state.emailState!=='on')}</View>
   <Text style={styles.body}>{copy.emailFoot}</Text><Text style={styles.heading}>{copy.publishedTitle}</Text>
   <Pressable accessibilityRole="checkbox" accessibilityState={{checked:state.excludePublications,disabled:saving}} disabled={saving} onPress={()=>void save('exclude:'+(state.excludePublications?'off':'on'))} style={styles.button}><Text style={styles.body}>{state.excludePublications?'☑':'☐'} {copy.exclude}</Text></Pressable>
   <Text style={styles.body}>{copy.publishedFoot}</Text>
  </View>:null}
  {message?<Text accessibilityRole="alert" style={styles.body}>{message}</Text>:null}
 </View>;
}
const styles=StyleSheet.create({section:{gap:spacing.md,paddingVertical:spacing.md},heading:{color:colors.ink,fontSize:19,fontWeight:'700'},body:{color:colors.ink,fontSize:15,lineHeight:22},actions:{flexDirection:'row',flexWrap:'wrap',gap:spacing.md},button:{borderWidth:1,borderColor:colors.line,padding:spacing.md,minHeight:48,justifyContent:'center'},label:{color:colors.ink,fontSize:16,fontWeight:'600'}});
