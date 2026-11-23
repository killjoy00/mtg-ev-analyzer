import {useCallback,useRef,useState} from 'react';
import {useFocusEffect,router} from 'expo-router';
import {Pressable,StyleSheet,View} from 'react-native';
import {Text} from '@/src/components/Text';
import {resultsRequest,type ResultsSnapshot} from '@/src/api/results';
import {readSession,subscribeSession,type MobileSession} from '@/src/storage/session';
import {resultsCopy as copy} from '@/src/resultsCopy';
import {colors,spacing} from '@/src/theme';
import {themedStyles,useAppTheme} from '@/src/appearance';
import {CARD_SIZES,useCardSizePreference,writeCardSize} from '@/src/cardSize';

export function ResultsPreferences({settings=false}:{settings?:boolean}){
 useAppTheme();
 const [state,setState]=useState<ResultsSnapshot|null>(null);
 const [kind,setKind]=useState<'prompt'|'notice'|null>(null);
 const [message,setMessage]=useState(''),[saving,setSaving]=useState(false);
 const [newsChoice,setNewsChoice]=useState<'on'|'off'|null>(null),[weeklyChoice,setWeeklyChoice]=useState(false);
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
  try{const value=await resultsRequest(session,action);if(version!==generation.current)return;setState(value);if(/^(signup|prompt|notice|settings|weekly|news):/.test(action))setKind(null);}
  catch(error){if(version===generation.current)setMessage(error instanceof Error?error.message:'Could not save this choice.');}
  finally{if(version===generation.current)setSaving(false);}
 };
 const button=(label:string,action:string,selected?:boolean)=><Pressable key={action} accessibilityRole="button" accessibilityState={{disabled:saving||action.includes('::'),...(selected===undefined?{}:{selected})}} disabled={saving||action.includes('::')} style={styles.button} onPress={()=>void save(action)}><Text style={styles.label}>{label}</Text></Pressable>;
 const cardControls=settings?<CardDisplaySettings />:null;
 if(!state?.active)return settings?<View style={styles.section}>{cardControls}{message?<Text accessibilityRole="alert">{message}</Text>:null}</View>:null;
 return <View style={styles.section}>
  {cardControls}
  {kind==='prompt'?<View style={styles.section}>
   <Text style={styles.heading}>{copy.newSetTitle}</Text>
   <Text style={styles.body}>{copy.newSetBody}</Text>
   {(['on','off'] as const).map(choice=><Pressable key={choice} accessibilityRole="radio"
     accessibilityState={{checked:newsChoice===choice,disabled:saving}}
     disabled={saving} onPress={()=>setNewsChoice(choice)} style={styles.choiceRow}>
     <Text style={styles.choiceSymbol}>{newsChoice===choice?'◉':'◯'}</Text>
     <Text style={styles.body}>{choice==='on'?copy.newSetYes:copy.newSetNo}</Text>
   </Pressable>)}
   <Pressable accessibilityRole="checkbox" accessibilityState={{checked:weeklyChoice,disabled:saving}}
     disabled={saving} onPress={()=>setWeeklyChoice(v=>!v)} style={styles.choiceRow}>
     <Text style={styles.choiceSymbol}>{weeklyChoice?'☑':'☐'}</Text><Text style={styles.body}>{copy.weeklyOptIn}</Text>
   </Pressable>
   <View style={styles.actions}>{button('Save choices','signup:'+(newsChoice||'')+':'+(weeklyChoice?'on':'off'))}</View>
   {newsChoice===null?<Text style={styles.body}>Choose Yes or No to save. Email is optional.</Text>:null}
   <Text style={styles.body}>{copy.emailOptional}</Text>
  </View>:kind==='notice'?<View style={styles.section}>
   <Text style={styles.heading}>{copy.noticeTitle}</Text>
   {copy.noticeBody.map(p=><Text key={p} style={styles.body}>{p}</Text>)}
   <View style={styles.actions}>{button(copy.noticeButton,'notice:on')}{button('Dismiss','notice:dismiss')}</View>
   <Text style={styles.body}>{copy.noticeFoot}</Text>
   <View style={styles.actions}><Pressable accessibilityRole="link" onPress={()=>router.push('/privacy')}><Text style={styles.body}>Privacy Policy</Text></Pressable><Text style={styles.body}> · </Text><Pressable accessibilityRole="link" onPress={()=>router.push('/terms')}><Text style={styles.body}>Terms</Text></Pressable></View>
  </View>:null}
  {settings?<View style={styles.section}>
   <Text style={styles.heading}>{copy.emailTitle}</Text>
   <Text style={styles.heading}>{copy.newSetLabel}</Text><Text style={styles.body}>{copy.newSetBody}</Text>
   <Text style={styles.body}>Pack One news: {state.newsEmailState==='on'?'On':'Off'}</Text>
   <View style={styles.actions}>{button(state.newsEmailState==='on'?'Turn off':'Turn on',state.newsEmailState==='on'?'news:off':'news:on')}</View>
   <Text style={styles.heading}>{copy.weeklyLabel}</Text><Text style={styles.body}>{copy.weeklyBody}</Text>
   <Text style={styles.body}>Weekly results: {state.emailState==='on'?'On':'Off'}</Text>
   <View style={styles.actions}>{button(state.emailState==='on'?'Turn off':'Turn on',state.emailState==='on'?'weekly:off':'weekly:on')}</View>
   <Text style={styles.body}>{copy.emailFoot}</Text><Text style={styles.heading}>{copy.publishedTitle}</Text>
   <Pressable accessibilityRole="checkbox" accessibilityState={{checked:state.excludePublications,disabled:saving}} disabled={saving} onPress={()=>void save('exclude:'+(state.excludePublications?'off':'on'))} style={styles.button}><Text style={styles.body}>{state.excludePublications?'☑':'☐'} {copy.exclude}</Text></Pressable>
   <Text style={styles.body}>{copy.publishedFoot}</Text>
  </View>:null}
  {message?<Text accessibilityRole="alert" style={styles.body}>{message}</Text>:null}
 </View>;
}
export function CardDisplaySettings() {
 const {size,ready}=useCardSizePreference();
 return <View style={styles.cardSettings}>
   <Text style={styles.heading}>Card size</Text>
   <Text style={styles.body}>Choose how cards appear during a pick.</Text>
   <View style={styles.cardChoices} accessibilityLabel="Card size preferences">
     {CARD_SIZES.map(option=><Pressable key={option} testID={`settings-card-size-${option}`}
       accessibilityRole="radio" accessibilityLabel={`${option} card size`}
       accessibilityState={{checked:ready&&size===option,disabled:!ready}}
       disabled={!ready} onPress={()=>void writeCardSize(option)}
       style={[styles.cardChoice,ready&&size===option&&styles.cardChoiceSelected]}>
       <Text style={[styles.cardChoiceText,ready&&size===option&&styles.cardChoiceTextSelected]}>
         {option==='standard'?'Standard':option==='compact'?'Compact':'Large'}
       </Text>
     </Pressable>)}
   </View>
 </View>;
}
const styles=themedStyles(StyleSheet.create({choiceRow:{flexDirection:'row',alignItems:'center',minHeight:44,gap:spacing.sm},choiceSymbol:{color:colors.accent,fontSize:22},section:{gap:spacing.md,paddingVertical:spacing.md},heading:{color:colors.ink,fontSize:19,fontWeight:'700'},body:{color:colors.ink,fontSize:15,lineHeight:22},actions:{flexDirection:'row',flexWrap:'wrap',gap:spacing.md},button:{borderWidth:1,borderColor:colors.line,padding:spacing.md,minHeight:48,justifyContent:'center'},label:{color:colors.ink,fontSize:16,fontWeight:'600'},
cardSettings:{gap:spacing.sm,paddingVertical:spacing.sm,borderBottomWidth:1,borderColor:colors.line},
cardChoices:{flexDirection:'row',flexWrap:'wrap',gap:spacing.sm},
cardChoice:{minHeight:44,alignItems:'center',justifyContent:'center',paddingHorizontal:spacing.md,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.lineStrong},
cardChoiceSelected:{backgroundColor:colors.accentSoft,borderColor:colors.accent},
cardChoiceText:{color:colors.ink,fontSize:14,fontWeight:'700'},
cardChoiceTextSelected:{color:colors.accentDark,fontWeight:'800'}
}));
