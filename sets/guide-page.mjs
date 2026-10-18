import {bindGuidePanels,installSetGuides} from '../set-guides.mjs';
installSetGuides();
for(const guide of document.querySelectorAll('.set-guide'))bindGuidePanels(guide,{results:location.hash==='#results'});
