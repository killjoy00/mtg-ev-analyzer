"""Small predeclared, rules-text-checked exploratory synergy registry.

These edges are researcher-specified mechanical hypotheses, not independent
decision-quality judgments or a human-reviewed production registry.
"""
import argparse
import hashlib
import json
from pathlib import Path
from pool_aware_archive import read_json
from pool_aware_features import canonical

PINS = {
    'tdm':'2d01c97052b42acfc489929de2240cff1f630a2ddda1f15fa91b5436a8c41045',
    'hob':'4594f305a0a39c2c67e4279950e896e9c0b50a5c580b076b41ee2fffdc40ceb9',
    'powered-cube':'cdcabb63c18e8bf59b0bbc19ad10dff63c86ee5921b47af9a16432af128b035b',
}
DRAGONS=('Armament Dragon','Boulderborn Dragon','Jeskai Shrinekeeper','Karakyk Guardian','Sonic Shrieker','Kheru Goldkeeper')
MOBILIZE=('Dalkovan Packbeasts','Dragonback Lancer','Nightblade Brigade','Shock Brigade','Voice of Victory','Reigning Victor','Venerated Stormsinger')
EQUIPMENT=('Dwarven Mattock','Dwarven Shortsword','Crude Bent Blade','Goblin Plate Mail','Well-Worn Spatula')
DWARVES=('Iron Hills Blacksmith','Dori, Bearer of Friends','Dáin Ironfoot','Iron Hills Stalwart')
TOKENS=('Dori, Bearer of Friends','Dáin Ironfoot','Dwarven Shortsword','Iron Hills Blacksmith')
CUBE_EQUIPMENT=('Batterskull','Kaldra Compleat',"Umezawa's Jitte",'Skullclamp')
ARTIFACTS=('Mox Emerald','Mox Sapphire','Mox Jet','Mox Ruby','Mox Pearl','Sol Ring','Mana Vault','Portable Hole','Retrofitter Foundry')
# Each tuple lists the payoff, a required literal Oracle fragment, named
# enablers, and per-enabler field/fragment checks. The two-distinct threshold
# measures already-drafted support, not a guarantee of a playable combination.
SPEC = {
 'tdm': [
     *((n,'When a Dragon you control enters',DRAGONS,'type_line','Dragon') for n in
       ('Breaching Dragonstorm','Corroding Dragonstorm','Encroaching Dragonstorm','Roiling Dragonstorm','Teeming Dragonstorm')),
     ('Dragonstorm Globe','Each Dragon you control enters',DRAGONS,'type_line','Dragon'),
     ('Caustic Exhale','behold a Dragon',DRAGONS,'type_line','Dragon'),
     ('Dispelling Exhale','behold a Dragon',DRAGONS,'type_line','Dragon'),
     ('Starry-Eyed Skyrider','Attacking tokens you control have flying',MOBILIZE,'oracle_text','Mobilize'),
     ('Bone-Cairn Butcher','Attacking tokens you control have deathtouch',MOBILIZE,'oracle_text','Mobilize'),
 ],
 'hob': [
     ('Dwalin, Weaponmaster','each Equipment you control',EQUIPMENT,'type_line','Equipment'),
     ("Dáin's Company",'Dwarf or Equipment card',EQUIPMENT,'type_line','Equipment'),
     ('Dwarven Mattock','attach it to target Dwarf',DWARVES,'type_line','Dwarf'),
     ('Belladonna Took','Whenever a token you control enters',TOKENS,'oracle_text','token'),
     ('Bard, King of Dale','tokens would be created under your control',TOKENS,'oracle_text','token'),
     ("Chief Warg's Company",'two or more other Wolves',('Bejeweled Warg','Duskwatch Hunter','Head of the Hunt'),'type_line','Wolf'),
 ],
 'powered-cube': [
     ('Underworld Breach','has escape',("Lion's Eye Diamond",'Brain Freeze'),'oracle_text',('Discard your hand','mills three cards')),
     ('Crucible of Worlds','play lands from your graveyard',('Strip Mine','Wasteland'),'oracle_text','Sacrifice this land'),
     ('Stoneforge Mystic','Equipment card',CUBE_EQUIPMENT,'type_line','Equipment'),
     ('Urza, Lord High Artificer','Tap an untapped artifact you control',ARTIFACTS,'type_line','Artifact'),
     ('Tinker','Search your library for an artifact card',('Myr Battlesphere','Sundering Titan','Kaldra Compleat'),'type_line','Artifact'),
     ('Sneak Attack','put a creature card from your hand',('Griselbrand','Archon of Cruelty','Atraxa, Grand Unifier'),'type_line','Creature'),
 ],
}


def build(set_id,path):
    digest=hashlib.sha256(path.read_bytes()).hexdigest()
    if digest!=PINS[set_id]:
        raise ValueError('rules metadata checksum mismatch')
    data=read_json(path)
    result=[]
    for payoff,fragment,names,field,need in SPEC[set_id]:
        c=canonical(data[payoff])
        if not c or fragment.casefold() not in c['oracle_text'].casefold():
            raise ValueError('payoff rules mismatch: '+payoff)
        cards=[]
        for i,name in enumerate(names):
            v=canonical(data[name])
            term=need[i] if isinstance(need,tuple) else need
            if not v or term.casefold() not in v.get(field,'').casefold():
                raise ValueError('enabler rules mismatch: '+name)
            cards.append(v['id'])
        if len(set(cards))!=len(cards) or c['id'] in cards:
            raise ValueError('duplicate interaction IDs')
        result.append({'payoff':c['id'],'enablers':cards,'minimum_distinct':2,
            'status':'exploratory_rules','rules_reference':f'pinned {set_id} rules snapshot sha256:{digest}',
            'payoff_name':payoff,'enabler_names':list(names),'payoff_fragment':fragment,
            'enabler_field':field,'enabler_fragments':list(need) if isinstance(need,tuple) else [need]*len(names)})
    return {'schema':1,'scope':'exploratory_rules_only','metadata_sha256':digest,'edges':result}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--set',choices=tuple(PINS),required=True)
    p.add_argument('--metadata',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args()
    r=build(a.set,a.metadata)
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(r,indent=2)+'\n',encoding='utf8')
    print(f"Prepared {len(r['edges'])} exploratory rule-checked edges; no independent quality labels")


if __name__=='__main__':
    main()
