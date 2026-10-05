import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/src/components/Text';
import { ScreenArea as SafeAreaView } from '@/src/components/ScreenArea';

import DraftRunScreen from './draft-run';
import {
  createDraftRunShare,
  loadCreatorChallengeInfo,
  loadDraftRun,
  startCreatorChallenge,
  submitDraftRunPick,
  type CreatorChallengeInfo,
  type DraftRunState,
} from '@/src/api/draftRun';
import { ensureGuestSession } from '@/src/api/guest';
import { useAppResume } from '@/src/hooks/useAppResume';
import type { SharedRunSurface } from '@/src/state/sharedRunSurface';
import { readCreatorChallengeContinuation, writeCreatorChallengeContinuation } from '@/src/storage/creatorChallenge';
import { readSession, subscribeSession, type MobileSession } from '@/src/storage/session';
import { colors, spacing } from '@/src/theme';

type State=
  |{status:'loading'}
  |{status:'invite';info:CreatorChallengeInfo;session:MobileSession}
  |{status:'ready';info:CreatorChallengeInfo;session:MobileSession;surface:SharedRunSurface;epoch:number}
  |{status:'error';message:string};

function sameSession(left:MobileSession,right:MobileSession|null){
  return Boolean(right&&left.playerToken===right.playerToken&&left.accountToken===right.accountToken&&left.subjectId===right.subjectId);
}

function checked(run:DraftRunState,challengeId:string){
  if(run.day!==null||run.creator_challenge_id!==challengeId)throw new Error('The server returned a different creator challenge.');
  return run;
}

function CreatorRunGate({identifier}:{identifier:string}){
  const [state,setState]=useState<State>({status:'loading'});
  const stateRef=useRef<State>(state);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState<string|null>(null);
  const mounted=useRef(true),generation=useRef(0),epoch=useRef(0);
  const reloadRef=useRef<()=>Promise<void>>(async()=>{});

  const commit=useCallback((next:State)=>{stateRef.current=next;setState(next);},[]);
  const makeSurface=useCallback((run:DraftRunState,session:MobileSession,info:CreatorChallengeInfo):SharedRunSurface=>({
    initialRun:checked(run,info.id),
    session,
    async loadRun(){return checked(await loadDraftRun(run.id,session),info.id);},
    async submitPick(current,cardId){return checked(await submitDraftRunPick(current,cardId,session),info.id);},
    async createShare(){return createDraftRunShare(run.id,session);},
  }),[]);

  const reload=useCallback(async()=>{
    const request=++generation.current;
    const current=()=>mounted.current&&request===generation.current;
    try{
      const session=await ensureGuestSession();if(!current())return;
      const info=await loadCreatorChallengeInfo(identifier,session);if(!current())return;
      const persisted=await readSession();if(!current())return;
      if(!sameSession(session,persisted))throw new Error('Your Pack One player session changed. Reopen this creator challenge.');
      const runId=await readCreatorChallengeContinuation(info.id,session);if(!current())return;
      if(runId){
        const run=checked(await loadDraftRun(runId,session),info.id);if(!current())return;
        commit({status:'ready',info,session,surface:makeSurface(run,session,info),epoch:epoch.current});
      }else{
        const previous=stateRef.current;
        if(previous.status==='ready'&&sameSession(previous.session,session))return;
        commit({status:'invite',info,session});
      }
      setMessage(null);
    }catch(error:unknown){
      if(!current())return;
      const detail=error instanceof Error?error.message:'This creator challenge is unavailable.';
      if(stateRef.current.status==='ready')setMessage(detail);else commit({status:'error',message:detail});
    }
  },[commit,identifier,makeSurface]);

  useEffect(()=>{reloadRef.current=reload;},[reload]);
  useEffect(()=>{
    mounted.current=true;
    const unsubscribe=subscribeSession(next=>{
      const current=stateRef.current;
      if('session'in current&&sameSession(current.session,next))return;
      generation.current+=1;epoch.current+=1;setBusy(false);setMessage(null);commit({status:'loading'});
      void reloadRef.current();
    });
    return()=>{unsubscribe();mounted.current=false;generation.current+=1;epoch.current+=1;};
  },[commit]);
  useFocusEffect(useCallback(()=>{void reload();return()=>{generation.current+=1;};},[reload]));
  useAppResume(reload);

  const accept=async()=>{
    const current=stateRef.current;if(current.status!=='invite'||busy)return;
    if(!current.session.accountToken){
      router.push({pathname:'/account',params:{returnTo:'creator',creator:identifier}});
      return;
    }
    setBusy(true);setMessage(null);const request=++generation.current;
    try{
      const run=checked(await startCreatorChallenge(current.session,current.info.id),current.info.id);
      await writeCreatorChallengeContinuation(current.info.id,run.id,current.session);
      if(!mounted.current||request!==generation.current)return;
      commit({status:'ready',info:current.info,session:current.session,surface:makeSurface(run,current.session,current.info),epoch:epoch.current});
    }catch(error:unknown){
      if(mounted.current&&request===generation.current)setMessage(error instanceof Error?error.message:'This creator challenge could not be started.');
    }finally{if(mounted.current&&request===generation.current)setBusy(false);}
  };

  if(state.status==='ready')return <View style={styles.safe}>{message?<Text accessibilityRole="alert" style={styles.error}>{message}</Text>:null}<DraftRunScreen key={state.epoch} shared={state.surface}/></View>;
  if(state.status==='loading')return <SafeAreaView style={styles.safe}><View style={styles.page}><ActivityIndicator/><Text style={styles.body}>Recovering this creator challenge…</Text></View></SafeAreaView>;
  if(state.status==='error')return <SafeAreaView style={styles.safe}><View style={styles.page}><Text style={styles.title}>Creator challenge unavailable.</Text><Text accessibilityRole="alert" style={styles.body}>{state.message}</Text><Pressable accessibilityRole="button" onPress={()=>void reload()} style={styles.button}><Text style={styles.buttonText}>Try again</Text></Pressable></View></SafeAreaView>;

  const dailyContext=state.info.source_type==='daily'&&state.info.source_day
    ? `Originally played as the ${new Date(state.info.source_day+'T12:00:00Z').toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'})} Daily.`
    : null;
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.page}>
    <Text style={styles.eyebrow}>BEAT THE CREATOR</Text>
    <Text style={styles.title}>{state.info.headline||`Can you beat ${state.info.creator_name}?`}</Text>
    <Text style={styles.body}>{state.info.creator_name} scored {state.info.score}/100 on these {state.info.run_length} real trophy-draft decisions.</Text>
    <Text style={styles.body}>You will see the same packs and prior draft context.</Text>
    {dailyContext?<Text style={styles.body}>{dailyContext} This replay is unranked and does not use your Daily attempt.</Text>:null}
    <Pressable accessibilityRole="button" disabled={busy} onPress={()=>void accept()} style={styles.button}><Text style={styles.buttonText}>{busy?'Starting…':state.session.accountToken?`Play ${state.info.creator_name}’s Run`:'Sign in to play this challenge'}</Text></Pressable>
    {message?<Text accessibilityRole="alert" style={styles.error}>{message}</Text>:null}
    <Pressable accessibilityRole="button" onPress={()=>router.dismissTo('/')}><Text style={styles.link}>Back home</Text></Pressable>
  </ScrollView></SafeAreaView>;
}

export default function CreatorRunScreen(){
  const params=useLocalSearchParams<{creator?:string}>();
  const identifier=typeof params.creator==='string'?params.creator:'';
  if(!identifier)return <SafeAreaView style={styles.safe}><View style={styles.page}><Text style={styles.title}>This creator link is invalid.</Text></View></SafeAreaView>;
  return <CreatorRunGate identifier={identifier}/>;
}

const styles=StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.page},
  page:{flexGrow:1,padding:spacing.xl,gap:spacing.md,justifyContent:'center',alignSelf:'center',width:'100%',maxWidth:700},
  eyebrow:{color:colors.accent,fontSize:11,fontWeight:'800',letterSpacing:1.4},
  title:{color:colors.ink,fontSize:30,lineHeight:36,fontWeight:'800'},
  body:{color:colors.muted,fontSize:16,lineHeight:23},
  button:{minHeight:52,backgroundColor:colors.accent,alignItems:'center',justifyContent:'center',paddingHorizontal:spacing.lg,marginTop:spacing.sm},
  buttonText:{color:'#fff',fontSize:16,fontWeight:'800',textAlign:'center'},
  link:{color:colors.accentDark,fontSize:15,fontWeight:'700',textDecorationLine:'underline'},
  error:{color:colors.danger,fontSize:13,lineHeight:18,padding:spacing.sm},
});
