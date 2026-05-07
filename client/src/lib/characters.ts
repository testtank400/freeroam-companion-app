// Character data — replace with API fetch when ready
// Design: Tactical Dark Ops / Military UI

export type PrivacyStatus = 'private' | 'public' | 'linked';

export interface Character {
  id: string;
  name: string;
  creator: string;
  image: string;
  privacy: PrivacyStatus;
  backstory: string;
  about: {
    fullName: string;
    designation: string;
    affiliation: string;
    rank: string;
    origin: string;
    bio: string;
  };
  appearance: {
    height: string;
    build: string;
    hair: string;
    eyes: string;
    distinguishingFeatures: string;
    equipment: string;
    description: string;
  };
}

export const characters: Character[] = [
  {
    id: 'trooper-kane',
    name: 'Trooper-Kane',
    creator: 'Test Tank',
    image: 'https://d2xsxph8kpxj0f.cloudfront.net/310519663635543348/cxwoV3UVdPSrRocF96aWqA/char-trooper-kane-B2ryY47p5wEb8ftCYiUY6Z.webp',
    privacy: 'private',
    backstory: 'Trooper Kane survived the fall of his Equestria by following orders without hesitation, a discipline that became his armor against the guilt of those he couldn\'t save. He carries the weight of every mission briefing like scripture — not because he believes in the cause, but because belief is a luxury soldiers can\'t afford.',
    about: {
      fullName: 'Sergeant Marcus Kane',
      designation: 'Trooper-Kane / Unit 0-4-4',
      affiliation: 'Blacklight Division, 3rd Armored Regiment',
      rank: 'Sergeant First Class',
      origin: 'Timeline Equestria-7, Sector 9 Collapse Zone',
      bio: 'Trooper Kane survived the fall of his Equestria by following orders without hesitation — a discipline that became his armor against the guilt of those he couldn\'t save. He carries the weight of every mission briefing like scripture, not because he believes in the cause, but because belief is a luxury soldiers can\'t afford. After the Collapse, he was conscripted into Blacklight\'s cross-timeline stabilization force and has served without complaint for eleven years. His file is marked with seventeen commendations and zero personal leave requests.',
    },
    appearance: {
      height: '6\'2" (188 cm)',
      build: 'Heavy / Power-armored frame',
      hair: 'Unknown — always helmeted',
      eyes: 'Unknown — dark visor',
      distinguishingFeatures: 'Three-star insignia on chest plate, wing emblem on helmet crown, battle-worn armor plating with micro-fractures along left pauldron',
      equipment: 'Mk-VII Blacklight Power Armor, integrated HUD, mag-locked sidearm holster, tactical utility belt',
      description: 'Kane is never seen out of his armor. His suit is matte black with a brushed-steel wing insignia across the chest — the mark of the 3rd Armored. The helmet\'s visor is a seamless dark panel that reflects nothing. His movements are deliberate and economical, every gesture the product of years of drilled discipline.',
    },
  },
  {
    id: 'trooper-voss',
    name: 'Trooper-Voss',
    creator: 'Test Tank',
    image: 'https://d2xsxph8kpxj0f.cloudfront.net/310519663635543348/cxwoV3UVdPSrRocF96aWqA/char-trooper-voss-4kUtHrjL4pAkFBwLvUYHL7.webp',
    privacy: 'private',
    backstory: '"Sir. Ma\'am. We\'ll keep you secure." Trooper Voss\'s voice is filtered through his helmet, clipped and professional. He carries himself like someone who\'s been trained to be invisible — present only when needed, gone the moment the threat is neutralized. His loyalty is to the mission, not the person.',
    about: {
      fullName: 'Corporal Dren Voss',
      designation: 'Trooper-Voss / Unit 0-7-1',
      affiliation: 'Blacklight Division, Close Protection Detail',
      rank: 'Corporal, Specialist Grade',
      origin: 'Timeline NT-X7, Northern Territories',
      bio: 'Voss was recruited from the Northern Territories\' border enforcement corps after demonstrating exceptional threat-assessment scores. His voice is always filtered through his helmet — clipped, professional, and deliberately impersonal. He carries himself like someone trained to be invisible: present only when needed, absent the moment the threat is neutralized. Voss has never filed a grievance, never requested reassignment, and has been present at forty-three close-protection operations without a single principal casualty.',
    },
    appearance: {
      height: '5\'11" (180 cm)',
      build: 'Athletic / Tactical',
      hair: 'Unknown — always helmeted',
      eyes: 'Amber visor glow',
      distinguishingFeatures: 'Honeycomb-texture armor panels, amber visor with hexagonal grid pattern, NT-X7 unit designation on chest plate, squad patch on right shoulder',
      equipment: 'NT-X7 Tactical Armor Suite, amber-spectrum visor, integrated comm system, compact sidearm, breaching charges',
      description: 'Voss\'s armor is sleeker than standard-issue — the honeycomb texture panels are a custom modification from his NT-X7 unit. The amber visor is his most distinctive feature, casting a faint warm glow in low-light environments. His movements are fluid and controlled, the product of close-quarters training rather than brute force.',
    },
  },
  {
    id: 'trooper-kaine',
    name: 'Trooper-Kaine',
    creator: 'Test Tank',
    image: 'https://d2xsxph8kpxj0f.cloudfront.net/310519663635543348/cxwoV3UVdPSrRocF96aWqA/char-trooper-kaine-iXzZfW3d65AR8YX4g9qUs4.webp',
    privacy: 'private',
    backstory: 'A former special forces operative from a timeline where humanity never made it past World War III, Kaine joined Blacklight after watching their intervention save seventeen million lives in a single afternoon. She doesn\'t believe in causes — she believes in outcomes. Her file lists forty-two confirmed operations. The number she remembers is different.',
    about: {
      fullName: 'Lieutenant Sera Kaine',
      designation: 'Trooper-Kaine / Unit A-05',
      affiliation: 'Blacklight Division, Special Operations Command',
      rank: 'Lieutenant, Special Operations',
      origin: 'Timeline Sigma-Collapse, Post-WWIII Remnant State',
      bio: 'Kaine comes from a timeline where humanity never made it past World War III. She was a special forces operative in the Remnant State\'s last standing military unit when Blacklight\'s intervention saved seventeen million lives in a single afternoon. She doesn\'t believe in causes — she believes in outcomes. Her official file lists forty-two confirmed operations. The number she actually remembers is different, and she keeps that count private. She is regarded as one of Blacklight\'s most effective field operatives, though her commanding officers note she has never once smiled in a debrief.',
    },
    appearance: {
      height: '5\'7" (170 cm)',
      build: 'Lean / Combat-conditioned',
      hair: 'Short, dark black, slightly unkempt',
      eyes: 'Dark grey, intense focus',
      distinguishingFeatures: 'A-05 designation on armor, wing-skull hybrid patch on right pauldron, faint burn scarring on left forearm (usually covered), perpetually neutral expression',
      equipment: 'Blacklight Special Operations Armor (lighter than standard), compact assault configuration, dual sidearms, integrated tactical display on left forearm',
      description: 'Kaine\'s armor is lighter than standard Blacklight issue — modified for speed and mobility over protection. The A-05 designation is stenciled in faded white on her chest plate. Her dark hair is the only thing about her that isn\'t controlled: it sits slightly out of regulation, the one detail she\'s never bothered to correct. Her expression rarely changes regardless of circumstances.',
    },
  },
  {
    id: 'echo-three',
    name: 'Echo-Three',
    creator: 'Test Tank',
    image: 'https://d2xsxph8kpxj0f.cloudfront.net/310519663635543348/cxwoV3UVdPSrRocF96aWqA/char-echo-three-i8CFXD5TiLfTUg6LXghcfZ.webp',
    privacy: 'public',
    backstory: 'Echo-Three earned her callsign during the evacuation of Timeline Sigma-Nine, where she held a chokepoint alone for seventeen minutes while civilians escaped through a collapsing transit corridor. She doesn\'t talk about it. She doesn\'t talk about most things. Her unit calls her "the quiet one" — which, in a squad of soldiers trained to be invisible, is saying something.',
    about: {
      fullName: 'Specialist Ren Ashford',
      designation: 'Echo-Three / Unit ECHO-3',
      affiliation: 'Blacklight Division, Echo Squad',
      rank: 'Specialist, First Class',
      origin: 'Timeline Sigma-Nine (evacuated, timeline collapsed)',
      bio: 'Echo-Three earned her callsign during the evacuation of Timeline Sigma-Nine, where she held a chokepoint alone for seventeen minutes while civilians escaped through a collapsing transit corridor. She doesn\'t talk about it. She doesn\'t talk about most things. Her psychological evaluation notes "exceptional composure under extreme duress" and "possible dissociative processing of traumatic events." Her unit calls her "the quiet one" — which, in a squad of soldiers trained to be invisible, is saying something. She is the last known survivor of Timeline Sigma-Nine.',
    },
    appearance: {
      height: '5\'5" (165 cm)',
      build: 'Slender / Agile',
      hair: 'Short, white — natural (accelerated stress-response depigmentation)',
      eyes: 'Steel grey, slightly unfocused at rest',
      distinguishingFeatures: 'ECHO-3 patch on left shoulder, unit wing insignia patch, small scar on left cheek (shrapnel, Sigma-Nine evacuation), white hair is a documented stress-response condition',
      equipment: 'Standard Blacklight tactical vest, ECHO-3 unit patches, compact sidearm, breaching kit, personal data tablet (encrypted)',
      description: 'Echo-Three\'s most striking feature is her white hair — a documented physiological response to the Sigma-Nine evacuation. She wears standard Blacklight tactical gear with the ECHO-3 patch prominently displayed on her left shoulder. The small scar on her cheek is the only visible mark from Sigma-Nine. Her expression at rest is distant, as though she\'s listening to something no one else can hear.',
    },
  },
  {
    id: 'ghost-seven',
    name: 'Ghost-Seven',
    creator: 'Test Tank',
    image: 'https://d2xsxph8kpxj0f.cloudfront.net/310519663635543348/cxwoV3UVdPSrRocF96aWqA/char-ghost-seven-JGo53CWWXifZh9LEpkZ32M.webp',
    privacy: 'linked',
    backstory: 'Ghost-Seven has no confirmed origin timeline. His file was created retroactively after he appeared in three separate Blacklight operations with no prior record. He doesn\'t deny being an operative — he simply doesn\'t confirm it either. The cracked mask is deliberate: "It reminds them I\'m not invincible," he told a handler once. The handler\'s report noted he said it like a threat.',
    about: {
      fullName: 'Unknown — designation only',
      designation: 'Ghost-Seven / Unit Z-10',
      affiliation: 'Blacklight Division, Deniable Assets Division (unconfirmed)',
      rank: 'Unknown — no official rank on record',
      origin: 'Unknown — no confirmed origin timeline',
      bio: 'Ghost-Seven has no confirmed origin timeline. His file was created retroactively after he appeared in three separate Blacklight operations with no prior record in any personnel database. He doesn\'t deny being an operative — he simply doesn\'t confirm it either. The cracked mask is deliberate: "It reminds them I\'m not invincible," he told a handler once. The handler\'s report noted he said it like a threat. His Z-10 designation suggests he was processed through the Deniable Assets Division, but those records are sealed above the clearance level of anyone who has tried to access them.',
    },
    appearance: {
      height: 'Estimated 6\'0" (183 cm)',
      build: 'Athletic / Covert operations build',
      hair: 'Unknown — always masked',
      eyes: 'Glowing cyan — cybernetic implants confirmed',
      distinguishingFeatures: 'Cracked white skull mask with cyan eye lenses, skull patch on left shoulder, SHINIGAMI designation on chest plate, Z-10 unit marking, black tactical wrappings over stealth suit',
      equipment: 'Custom stealth suit, cracked ceramic skull mask (deliberate), cybernetic eye implants (cyan spectrum), suppressed sidearm, unknown additional equipment (not disclosed in file)',
      description: 'Ghost-Seven\'s appearance is engineered for psychological impact as much as tactical function. The cracked skull mask is ceramic over a reinforced underlayer — the cracks are real damage he has chosen not to repair. The cyan glow of his cybernetic eyes is visible through the mask\'s eye sockets. He moves without sound. Handlers report that he is often present in a room before anyone realizes he has entered.',
    },
  },
];
