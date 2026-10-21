const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const Renderer = require('react-test-renderer');
const {compileModule} = require('./support/compile-module.cjs');
const {act} = Renderer;
const host = name => function Host(props) { return React.createElement(name,props,props.children); };
const text = node => typeof node==='string'?node:Array.isArray(node)?node.map(text).join(' '):node?text(node.children):'';
const flatten = value => Object.assign({},...(Array.isArray(value)?value.map(flatten):[value||{}]));
const url = name => `https://cards.scryfall.io/normal/${name}.jpg`;
const card={name:'Front',image_url:url('front'),display_faces:[
  {name:'Front',image_url:url('front'),large_image_url:url('large-front'),role:'front'},
  {name:'Back',image_url:url('back'),large_image_url:url('large-back'),role:'back'},
]};

async function fixture(width=390) {
  let closed=0,root,current=card;
  const native={View:host('View'),Text:host('Text'),Modal:host('Modal'),Pressable:host('Pressable'),ScrollView:host('ScrollView'),
    StyleSheet:{create:x=>x,absoluteFill:{position:'absolute'}},useWindowDimensions:()=>({width,height:844})};
  const {CardFaceViewer}=compileModule('src/components/CardFaceViewer.tsx',{
    'react-native':native,'expo-image':{Image:host('Image')},
    'react-native-safe-area-context':{SafeAreaView:host('SafeAreaView')},
    '@/src/components/ScreenArea':{ScreenArea:host('SafeAreaView')},
    '@/src/theme':{colors:{surface:'#fff',ink:'#111'},spacing:{sm:8,md:16,lg:24}},
  });
  const render=()=>React.createElement(CardFaceViewer,{card:current,onClose:()=>closed++});
  await act(async()=>{root=Renderer.create(render());});
  return {root,closed:()=>closed,
    setCard:async value=>{current=value;await act(async()=>root.update(render()));},
    resize:async value=>{width=value;await act(async()=>root.update(render()));},
    press:async name=>{const b=root.root.findAllByType('Pressable').find(n=>n.props.accessibilityLabel===name||text(n.toJSON?.()||{children:n.children})===name);assert.ok(b,name);await act(async()=>b.props.onPress());},
    close:async()=>act(async()=>root.unmount()),
  };
}

test('phone switches faces, resets on reopen and close is separate from any pick action',async()=>{
  const f=await fixture();
  try {
    assert.ok(f.root.root.findByProps({accessibilityLabel:'Show back: Back'}));
    await f.press('Show back: Back');
    assert.ok(f.root.root.findByProps({accessibilityLabel:'Show front: Front'}));
    const hidden=f.root.root.findAllByType('View').filter(n=>flatten(n.props.style).display==='none');
    assert.equal(hidden.length,1);
    assert.ok(hidden[0].findByProps({accessibilityLabel:'Front — Front'}));
    await f.press('Close card viewer');assert.equal(f.closed(),1);
    await f.setCard(null);await f.setCard(card);
    assert.ok(f.root.root.findByProps({accessibilityLabel:'Show back: Back'}));
    await f.setCard({name:'Single',image_url:url('single')});
    assert.equal(f.root.root.findAllByType('Image').length,1);
    assert.equal(f.root.root.findAllByType('Pressable').length,1);
  } finally {await f.close();}
});

test('tablet shows both faces and resize retains a usable phone switcher',async()=>{
  const f=await fixture(1024);
  try {
    assert.equal(f.root.root.findAllByType('Image').length,2);
    assert.equal(f.root.root.findAllByType('View').filter(n=>flatten(n.props.style).display==='none').length,0);
    assert.equal(f.root.root.findAllByType('Pressable').length,1);
    await f.resize(320);
    assert.ok(f.root.root.findByProps({accessibilityLabel:'Show back: Back'}));
  } finally {await f.close();}
});

test('failed large image falls back then offers retry without losing the other face',async()=>{
  const f=await fixture();
  try {
    await f.press('Show back: Back');
    await act(async()=>f.root.root.findAllByType('Image').find(n=>n.props.accessibilityLabel==='Back — Back').props.onError());
    assert.equal(f.root.root.findAllByType('Image').find(n=>n.props.accessibilityLabel==='Back — Back').props.source,url('back'));
    await act(async()=>f.root.root.findAllByType('Image').find(n=>n.props.accessibilityLabel==='Back — Back').props.onError());
    await f.press('Retry image for Back');
    assert.equal(f.root.root.findAllByType('Image').length,2);
    await f.press('Show front: Front');
    assert.ok(f.root.root.findByProps({accessibilityLabel:'Front — Front'}));
  } finally {await f.close();}
});

test('meld labels explain the other card instead of offering an ordinary back',async()=>{
  const f=await fixture();
  try {
    await f.setCard({...card,display_faces:[card.display_faces[0],{...card.display_faces[1],role:'meld_result',partner_name:'Partner'}]});
    await f.press('Show meld result: Back');
    assert.match(text(f.root.toJSON()),/Melds with\s+Partner\s*\. Both cards are required/);
  } finally {await f.close();}
});
