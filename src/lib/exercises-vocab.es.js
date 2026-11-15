// The Spanish names of the catalogue's body parts, target muscles, secondary
// muscles and equipment.
//
// These are the words the person READS on screen: the "Pecho" chip in the
// library, the "bíceps" tag under an exercise, the "barra" in the equipment
// row. The catalogue itself stores them in English ("chest", "biceps"), so
// this map is the bridge between what the screen says and what the data holds.
//
// The coach needs it: a person asking "dame ejercicios para el abdomen" is
// asking for the muscle group the screen calls "abdomen", and a search over
// the raw English values would find nothing.
//
// ONE source of truth: the Spanish locale spreads this map into its pack, so
// the screen and the coach can never call the same muscle two different
// things. The keys are the catalogue's own values (bp, tg, eq and the
// secondary muscles), so a value that the catalogue does not have must not
// appear here.

export const EXERCISE_LABELS = {
  // --- body part (bp) ---
  'back': 'espalda',
  'cardio': 'cardio',
  'chest': 'pecho',
  'lower arms': 'antebrazos',
  'lower legs': 'pantorrillas',
  'neck': 'cuello',
  'shoulders': 'hombros',
  'upper arms': 'brazos',
  'upper legs': 'piernas',
  'waist': 'abdomen',

  // --- equipment (eq) ---
  'assisted': 'asistido',
  'band': 'banda',
  'barbell': 'barra',
  'body weight': 'peso corporal',
  'bosu ball': 'bosu',
  'cable': 'polea',
  'dumbbell': 'mancuerna',
  'elliptical machine': 'elíptica',
  'ez barbell': 'barra EZ',
  'hammer': 'martillo',
  'kettlebell': 'kettlebell',
  'leverage machine': 'máquina de palanca',
  'medicine ball': 'balón medicinal',
  'olympic barbell': 'barra olímpica',
  'resistance band': 'banda de resistencia',
  'roller': 'rodillo',
  'rope': 'cuerda',
  'skierg machine': 'SkiErg',
  'sled machine': 'trineo',
  'smith machine': 'máquina Smith',
  'stability ball': 'fitball',
  'stationary bike': 'bici estática',
  'stepmill machine': 'escaladora',
  'tire': 'neumático',
  'trap bar': 'barra hexagonal',
  'upper body ergometer': 'ergómetro de brazos',
  'weighted': 'con lastre',
  'wheel roller': 'rueda abdominal',

  // --- target muscle (tg) ---
  'abductors': 'abductores',
  'abs': 'abdominales',
  'adductors': 'adductores',
  'biceps': 'bíceps',
  'calves': 'gemelos',
  'cardiovascular system': 'sistema cardiovascular',
  'delts': 'deltoides',
  'forearms': 'antebrazos',
  'glutes': 'glúteos',
  'hamstrings': 'isquiotibiales',
  'lats': 'dorsales',
  'levator scapulae': 'elevador de la escápula',
  'pectorals': 'pectorales',
  'quads': 'cuádriceps',
  'serratus anterior': 'serrato anterior',
  'spine': 'columna',
  'traps': 'trapecios',
  'triceps': 'tríceps',
  'upper back': 'espalda alta',

  // --- secondary muscles (sm) ---
  'abdominals': 'abdominales',
  'ankle stabilizers': 'estabilizadores de tobillo',
  'ankles': 'tobillos',
  'brachialis': 'braquial',
  'core': 'core',
  'deltoids': 'deltoides',
  'feet': 'pies',
  'grip muscles': 'agarre',
  'groin': 'ingle',
  'hands': 'manos',
  'hip flexors': 'flexores de cadera',
  'inner thighs': 'cara interna del muslo',
  'latissimus dorsi': 'dorsal ancho',
  'lower abs': 'abdominales inferiores',
  'lower back': 'zona lumbar',
  'obliques': 'oblicuos',
  'quadriceps': 'cuádriceps',
  'rear deltoids': 'deltoides posterior',
  'rhomboids': 'romboides',
  'rotator cuff': 'manguito rotador',
  'shins': 'espinillas',
  'soleus': 'sóleo',
  'sternocleidomastoid': 'esternocleidomastoideo',
  'trapezius': 'trapecio',
  'upper chest': 'pecho superior',
  'wrist extensors': 'extensores de muñeca',
  'wrist flexors': 'flexores de muñeca',
  'wrists': 'muñecas',
}

export default EXERCISE_LABELS
