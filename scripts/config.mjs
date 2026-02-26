export const MODULE_ID = 'coc7-special-damage';

export const CHARACTERISTICS = ['str', 'con', 'dex', 'siz', 'app', 'int', 'pow', 'edu'];
export const ATTRIBS = ['mp', 'san'];
export const ALL_TARGETS = [...CHARACTERISTICS, ...ATTRIBS];

export const STAT_PATHS = {
  str: 'system.characteristics.str.value',
  con: 'system.characteristics.con.value',
  dex: 'system.characteristics.dex.value',
  siz: 'system.characteristics.siz.value',
  app: 'system.characteristics.app.value',
  int: 'system.characteristics.int.value',
  pow: 'system.characteristics.pow.value',
  edu: 'system.characteristics.edu.value',
  mp: 'system.attribs.mp.value',
  san: 'system.attribs.san.value'
};

export const STAT_LABELS = {
  str: 'STR',
  con: 'CON',
  dex: 'DEX',
  siz: 'SIZ',
  app: 'APP',
  int: 'INT',
  pow: 'POW',
  edu: 'EDU',
  mp: 'MP',
  san: 'SAN'
};

export const ZERO_STAT_KEYS = {
  str: 'CSD.ZeroStat.str',
  con: 'CSD.ZeroStat.con',
  dex: 'CSD.ZeroStat.dex',
  siz: 'CSD.ZeroStat.siz',
  app: 'CSD.ZeroStat.app',
  int: 'CSD.ZeroStat.int',
  pow: 'CSD.ZeroStat.pow',
  edu: 'CSD.ZeroStat.edu'
};

export const AE_ICON = 'icons/skills/wounds/blood-drip-droplet-red.webp';

export const DEFAULT_CONFIG = {
  enabled: false,
  target: 'str',
  permanent: false,
  automatic: false
};
