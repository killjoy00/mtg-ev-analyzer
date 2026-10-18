import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Text } from '@/src/components/Text';
import { ScreenArea as SafeAreaView } from '@/src/components/ScreenArea';
import { useAccountState } from '@/src/hooks/useAccountState';
import {
  enablePushOnDevice,loadNativeReminders,PushPermissionDenied,saveNativeReminders,unregisterReminderDevice,
  type ReminderChannel,type ReminderSchedule,type ReminderSnapshot,
} from '@/src/api/reminders';
import { colors,spacing } from '@/src/theme';

const DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function deviceTimezone() {
  try{return Intl.DateTimeFormat().resolvedOptions().timeZone||'Etc/UTC';}
  catch{return 'Etc/UTC';}
}
function formatDate(date:string|null|undefined) {
  if(!date)return 'None yet';
  const parsed=new Date(date);
  return isNaN(parsed.getTime())?'Unavailable':parsed.toLocaleString();
}
export default function AccountRemindersScreen() {
  const {session,account,busy:accountBusy,message:loadMessage,refresh}=useAccountState({requireAccount:true});
  const [snapshot,setSnapshot]=useState<ReminderSnapshot|null>(null);
  const [schedule,setSchedule]=useState<ReminderSchedule|null>(null);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [notice,setNotice]=useState<string|null>(null);
  const [permissionBlocked,setPermissionBlocked]=useState(false);
  const ownerId=session?.accountUser?.id||null;
  const [loadedFor,setLoadedFor]=useState<string|null>(null);
  useEffect(()=>{
    let active=true;
    // Deferred state updates avoid cascading renders during effect setup.
    // The owner-key render guard prevents even a frame of the old account's UI.
    void Promise.resolve().then(async()=>{
      if(!active)return;
      setSnapshot(null);setSchedule(null);setLoading(true);setNotice(null);
      if(!session?.accountToken){setLoading(false);setLoadedFor(null);return;}
      try {
        const value=await loadNativeReminders(session);
        if(!active)return;
        setSnapshot(value);
        setSchedule({...value.schedule,timeZone:
          !value.nextAt&&!value.email.consentedAt&&!value.push.consentedAt?deviceTimezone():value.schedule.timeZone});
      }catch(err){
        if(active)setNotice(err instanceof Error?err.message:'Could not load reminders.');
      }finally{
        if(active){setLoading(false);setLoadedFor(session.accountUser?.id||null);}
      }
    });
    return ()=>{active=false;};
  },[session]);

  const toggleDay=(day:number)=>{
    if(!schedule)return;
    setSchedule(value=>{
      if(!value)return value;
      if(value.frequency==='weekly')return {...value,weekdays:[day]};
      if(value.weekdays.includes(day))return {...value,weekdays:value.weekdays.filter(v=>v!==day)};
      return {...value,weekdays:[...value.weekdays,day].sort((a,b)=>a-b)};
    });
  };
  const chooseFrequency=(frequency:ReminderSchedule['frequency'])=>{
    setSchedule(value=>value?{
      ...value,frequency,weekdays:frequency==='weekly'?(value.weekdays.length?[value.weekdays[0] ?? 1]:[1]):value.weekdays,
    }:value);
  };
  const save=async(channel:ReminderChannel,enabled:boolean)=>{
    if(!session?.accountToken||!schedule||saving||!snapshot)return;
    if(!/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(schedule.localTime)) {
      setNotice('Use 24-hour local time (HH:mm).');return;
    }
    if(!schedule.weekdays.length||(schedule.frequency==='weekly'&&schedule.weekdays.length!==1)){
      setNotice('Select one weekday for weekly reminders, or at least one for custom reminders.');return;
    }
    setSaving(true);setNotice(null);setPermissionBlocked(false);
    try {
      if(channel==='push'&&enabled&&!snapshot.push.enabled)await enablePushOnDevice(session);
      const updated=await saveNativeReminders(session,channel,enabled,schedule);
      if(channel==='push'&&!enabled)await unregisterReminderDevice(session);
      setSnapshot(updated);setSchedule(updated.schedule);
      setNotice(channel==='email'
        ? enabled?'Email reminders saved.':'Email reminders turned off.'
        : enabled?'Push reminders saved.':'Push reminders turned off.');
    }catch(error){
      if(error instanceof PushPermissionDenied)setPermissionBlocked(true);
      setNotice(error instanceof Error?error.message:'Could not update reminder settings. Your current choices were not changed.');
    }finally{setSaving(false);}
  };
  const disabled=saving||loading||accountBusy;
  if(accountBusy||loading||(Boolean(session?.accountToken)&&loadedFor!==ownerId))return <SafeAreaView style={styles.safe}><View style={styles.center}>
    <ActivityIndicator color={colors.accent}/><Text style={styles.body}>Loading reminders…</Text>
  </View></SafeAreaView>;
  if(!account||!session?.accountToken)return <SafeAreaView style={styles.safe}><View style={styles.center}>
    <Text accessibilityRole="alert" style={styles.alert}>{loadMessage||'Sign in to manage reminders.'}</Text>
    <Pressable accessibilityRole="button" onPress={()=>void refresh()} style={styles.button}><Text style={styles.buttonLabel}>Try again</Text></Pressable>
  </View></SafeAreaView>;

  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <Text style={styles.eyebrow}>ACCOUNT SETTINGS</Text>
    <Text style={styles.title}>Daily reminders</Text>
    <Text style={styles.body}>Choose when to get a reminder to play. Email and push are off until you enable each one.</Text>
    {snapshot?<View style={styles.panel}>
      <Text style={styles.heading}>Your saved channels</Text>
      <Text style={styles.body}>Email: {snapshot.email.enabled?'On':'Off'} · Push: {snapshot.push.enabled?'On':'Off'}</Text>
      <Text style={styles.body}>Next reminder: {formatDate(snapshot.nextAt)}</Text>
      {!snapshot.deliveryActive?<Text style={styles.alert}>Delivery is not active yet. Saved choices will not send reminders until activation.</Text>:null}
      <Text style={styles.help}>Latest email attempt: {snapshot.email.lastAttempt?.state||'none'}. Latest push attempt: {snapshot.push.lastAttempt?.state||'none'}.</Text>
      {snapshot.push.lastAttempt?.platformReceipt?<Text style={styles.help}>Push platform receipt: {snapshot.push.lastAttempt.platformReceipt} (not proof of display).</Text>:null}
      <Text style={styles.help}>Last confirmed email delivery: {formatDate(snapshot.email.deliveredAt)}</Text>
      <Text style={styles.help}>Last push provider acceptance: {formatDate(snapshot.push.providerAcceptedAt)}. This is not proof of device display.</Text>
    </View>:null}
    {schedule?<View style={styles.panel}>
      <Text style={styles.heading}>Schedule</Text>
      <Text style={styles.body}>All times below use your chosen local timezone. The game Dailies still reset on Pacific time.</Text>
      <View style={styles.choices}>{([
        ['daily','Every day'],['weekly','Once weekly'],['custom','Selected days'],
      ] as const).map(([frequency,label])=><Pressable key={frequency} accessibilityRole="radio"
        accessibilityState={{selected:schedule.frequency===frequency}} onPress={()=>chooseFrequency(frequency)}
        style={[styles.choice,schedule.frequency===frequency&&styles.selected]}>
        <Text style={styles.choiceLabel}>{label}</Text>
      </Pressable>)}</View>
      <Text style={styles.help}>Day of week</Text>
      <View style={styles.choices}>{DAYS.map((label,i)=><Pressable key={label} accessibilityRole="checkbox"
        accessibilityState={{checked:schedule.weekdays.includes(i)}}
        onPress={()=>toggleDay(i)} style={[styles.day,schedule.weekdays.includes(i)&&styles.selected]}>
        <Text style={styles.choiceLabel}>{label}</Text>
      </Pressable>)}</View>
      <Text style={styles.help}>Local time (HH:mm)</Text>
      <TextInput accessibilityLabel="Local reminder time" style={styles.input} value={schedule.localTime}
        maxLength={5} placeholder="09:00" autoCorrect={false} onChangeText={localTime=>setSchedule({...schedule,localTime})}/>
      <Text style={styles.help}>IANA timezone, such as America/Chicago</Text>
      <TextInput accessibilityLabel="Reminder timezone" style={styles.input} value={schedule.timeZone}
        maxLength={80} autoCapitalize="none" autoCorrect={false}
        onChangeText={timeZone=>setSchedule({...schedule,timeZone})}/>
    </View>:null}
    {snapshot&&schedule?<View style={styles.panel}>
      <Text style={styles.heading}>Email reminders</Text>
      <Text style={styles.body}>Sent only to the verified email on your Pack One account. Push consent is not affected.</Text>
      {!snapshot.email.eligible?<Text style={styles.alert}>Verify your sign-in email before enabling email reminders.</Text>:null}
      {snapshot.email.suppressed?<Text style={styles.alert}>Email reminders are suppressed following a bounce or complaint. Contact support to resolve.</Text>:null}
      <Pressable accessibilityRole="button" disabled={disabled||!snapshot.email.eligible||snapshot.email.suppressed}
        onPress={()=>void save('email',!snapshot.email.enabled)} style={[styles.button,(disabled||!snapshot.email.eligible||snapshot.email.suppressed)&&styles.disabled]}>
        <Text style={styles.buttonLabel}>{snapshot.email.enabled?'Turn email off now':'Enable email reminders'}</Text>
      </Pressable>
      {snapshot.email.enabled?<Pressable accessibilityRole="button" disabled={disabled}
        onPress={()=>void save('email',true)} style={styles.secondary}><Text style={styles.buttonLabel}>Save email schedule</Text></Pressable>:null}
    </View>:null}
    {snapshot&&schedule?<View style={styles.panel}>
      <Text style={styles.heading}>Push notifications</Text>
      <Text style={styles.body}>Requires this device’s explicit permission. Each phone or tablet can be registered independently. Email consent stays separate.</Text>
      <Pressable accessibilityRole="button" disabled={disabled}
        onPress={()=>void save('push',!snapshot.push.enabled)} style={[styles.button,disabled&&styles.disabled]}>
        <Text style={styles.buttonLabel}>{snapshot.push.enabled?'Turn push off now':'Enable push notifications'}</Text>
      </Pressable>
      {snapshot.push.enabled?<Pressable accessibilityRole="button" disabled={disabled}
        onPress={()=>void save('push',true)} style={styles.secondary}><Text style={styles.buttonLabel}>Save push schedule</Text></Pressable>:null}
      {permissionBlocked?<Pressable accessibilityRole="link" onPress={()=>void Linking.openSettings()} style={styles.secondary}>
        <Text style={styles.buttonLabel}>Open device notification settings</Text></Pressable>:null}
    </View>:null}
    {notice?<Text accessibilityRole="alert" style={styles.alert}>{notice}</Text>:null}
  </ScrollView></SafeAreaView>;
}
const styles=StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.page},
  page:{padding:spacing.lg,paddingBottom:spacing.xxl,gap:spacing.lg,alignSelf:'center',width:'100%',maxWidth:760},
  center:{flex:1,alignItems:'center',justifyContent:'center',gap:spacing.md,padding:spacing.lg},
  eyebrow:{color:colors.accent,fontSize:10,fontWeight:'800',letterSpacing:1.4},
  title:{color:colors.ink,fontSize:30,lineHeight:35,fontWeight:'800'},
  heading:{color:colors.ink,fontSize:18,fontWeight:'800'},
  body:{color:colors.muted,fontSize:15,lineHeight:22},
  help:{color:colors.muted,fontSize:13,lineHeight:19},
  panel:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,padding:spacing.lg,gap:spacing.md},
  choices:{flexDirection:'row',flexWrap:'wrap',gap:spacing.sm},
  choice:{minHeight:42,justifyContent:'center',borderWidth:1,borderColor:colors.lineStrong,paddingHorizontal:spacing.md},
  day:{minHeight:42,justifyContent:'center',borderWidth:1,borderColor:colors.lineStrong,paddingHorizontal:spacing.sm},
  selected:{borderColor:colors.accent,backgroundColor:colors.page},
  choiceLabel:{color:colors.ink,fontSize:13,fontWeight:'700'},
  input:{minHeight:52,borderWidth:1,borderColor:colors.lineStrong,backgroundColor:colors.surface,color:colors.ink,paddingHorizontal:spacing.md,fontSize:16},
  button:{minHeight:50,borderWidth:1,borderColor:colors.accent,alignItems:'center',justifyContent:'center',paddingHorizontal:spacing.md},
  secondary:{minHeight:45,alignItems:'center',justifyContent:'center',padding:spacing.sm,borderWidth:1,borderColor:colors.lineStrong},
  buttonLabel:{color:colors.accentDark,fontSize:15,fontWeight:'800'},
  alert:{color:colors.danger,fontSize:14,lineHeight:21},
  disabled:{opacity:.4},
});
