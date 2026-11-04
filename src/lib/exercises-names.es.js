// The exercise catalogue, in Spanish.
//
// The dataset ships 1.324 names in English. The product is Spanish, so the name
// a person reads must be Spanish too — and the SAME name everywhere: the list,
// the exercise sheet, the routine, the synced document and the coach's context.
//
// How the translation works (no black box, no service call):
//   1. a name that the dictionary knows as a whole wins (SPECIAL);
//   2. a leading equipment word ("dumbbell …") is moved to the end, because
//      Spanish names the movement first and the tool last ("… con mancuernas");
//   3. the rest is read as a movement plus modifiers: the MOVEMENT dictionary
//      matches the longest movement phrase, the MODIFIER dictionary reads the
//      remaining words, and the pieces are assembled in Spanish order
//      (movement → variation → position → technique → angle).
//
// Anything the dictionaries cannot read stays in English AND is reported by the
// test (unknown words are a failing assertion, not a silent gap), so the
// catalogue never drifts back into a mixed-language UI.

/* -------------------------------------------------------------- equipment -- */
// Leading equipment words → the Spanish tool phrase that closes the name.
const EQUIPMENT = {
  'battle ropes': 'con cuerdas de combate',
  'battling ropes': 'con cuerdas de combate',
  'medicine ball': 'con medicine ball',
  'resistance band': 'con banda elástica',
  'smith machine': 'en máquina smith',
  'body weight': 'a peso corporal',
  'wall ball': 'contra la pared',
  'dumbbells': 'con mancuernas',
  'dumbbell': 'con mancuernas',
  'barbell': 'con barra',
  'kettlebell': 'con kettlebell',
  'cable': 'en polea',
  'machine': 'en máquina',
  'band': 'con banda elástica',
  'bodyweight': 'a peso corporal',
  'sled': 'con trineo',
  'bosu': 'con bosu',
  'towel': 'con toalla',
  'chair': 'con silla',
  'sandbag': 'con bolsa de arena',
  'trx': 'con bandas de suspensión',
  'rope': 'con cuerda',
  'ropes': 'con cuerdas',
  'ball': 'con pelota',
  'bar': 'en barra',
  'lever': 'con palanca',
}

// The modifiers that must agree with the movement they qualify: "sentadilla
// completa", "remo inclinado", "abdominal alterno". Spanish adjectives follow
// the noun and change with its gender, so each one needs its feminine form.
const FEMININE = {
  'completo': 'completa',
  'parcial': 'parcial',
  'rápido': 'rápida',
  'pesado': 'pesada',
  'asistido': 'asistida',
  'alterno': 'alterna',
  'alternante': 'alternante',
  'inclinado': 'inclinada',
  'declinado': 'declinada',
  'plano': 'plana',
  'sentado': 'sentada',
  'arrodillado': 'arrodillada',
  'tumbado': 'tumbada',
  'colgado': 'colgada',
  'invertido': 'invertida',
  'inverso': 'inversa',
  'recto': 'recta',
  'estendido': 'extendida',
  'extendido': 'extendida',
  'elevado': 'elevada',
  'girado': 'girada',
  'alto': 'alta',
  'bajo': 'baja',
  'pliométrica': 'pliométrica',
}

/* --------------------------------------------------------------- movements -- */
// The movement itself. Longest phrase first at match time, so "bench press"
// wins over "press".
const MOVEMENTS = {
  'ab roller': 'rodillo abdominal',
  'ankle circles': 'círculos de tobillo',
  'wrist circles': 'círculos de muñeca',
  'arm circles': 'círculos de brazos',
  'jumping jack': 'saltos con apertura',
  'mountain climber': 'escalador de montaña',
  'bear crawl': 'arrastre del oso',
  'high knees': 'rodillas altas',
  'box jump': 'salto al cajón',
  'judo flip': 'volteo de judo',
  'inchworm': 'oruga',
  'inch worm': 'oruga',
  'farmer carry': 'caminata del granjero',
  "farmer's walk": 'caminata del granjero',
  'farmers walk': 'caminata del granjero',
  'fire hydrant': 'bombero',
  'dead bug': 'bicho muerto',
  'bird dog': 'perro pájaro',
  'cat cow': 'gato-vaca',
  "child's pose": 'pose del niño',
  'childs pose': 'pose del niño',
  'upward dog': 'perro hacia arriba',
  'downward dog': 'perro hacia abajo',
  'butterfly yoga': 'mariposa (yoga)',
  'windmill': 'molino',
  'wood chop': 'tijera',
  'russian twist': 'giro ruso',
  'russian curl': 'curl ruso',
  'russian swing': 'swing ruso',
  'american swing': 'swing americano',
  'kettlebell swing': 'swing de kettlebell',
  'goblet squat': 'sentadilla con goblet',
  'zercher squat': 'sentadilla Zercher',
  'jefferson squat': 'sentadilla Jefferson',
  'guillotine bench press': 'press de banca guillotina',
  'jm bench press': 'press de banca JM',
  'jm press': 'press JM',
  'svend press': 'press Svend',
  'tate press': 'press Tate',
  'seesaw press': 'press tijera',
  'pendlay row': 'remo Pendlay',
  'landmine press': 'press landmine',
  'zottman curl': 'curl Zottman',
  'jefferson curl': 'curl Jefferson',
  'arnold press': 'press Arnold',
  'french press': 'press francés',
  'pallof press': 'press Pallof',
  'leg press': 'press de pierna',
  'chest press': 'press de pecho',
  'shoulder press': 'press de hombro',
  'military press': 'press militar',
  'overhead press': 'press sobre la cabeza',
  'overhead tricep extension': 'extensión de tríceps sobre la cabeza',
  'overhead triceps extension': 'extensión de tríceps sobre la cabeza',
  'full range of motion': 'rango completo de movimiento',
  'push press': 'press de empuje',
  'bench press': 'press de banca',
  'close-grip push-up': 'flexión con agarre cerrado',
  'close grip push-up': 'flexión con agarre cerrado',
  'push-up': 'flexión',
  'push up': 'flexión',
  'pull-up': 'dominada',
  'pull up': 'dominada',
  'chin-up': 'dominada supina',
  'chin up': 'dominada supina',
  'body-up': 'dominada prona',
  'pullup': 'dominada',
  'pull ups': 'dominadas',
  'bench pull-ups': 'dominadas en banco',
  'lat pulldown': 'jalón al pecho',
  'wide-grip pulldown': 'jalón con agarre abierto',
  'close-grip pulldown': 'jalón con agarre cerrado',
  'underhand pulldown': 'jalón con agarre supinado',
  'lateral pulldown': 'jalón lateral',
  'pulldown': 'jalón',
  'pullover': 'trazón',
  'upright row': 'remo vertical',
  'bent over row': 'remo inclinado',
  'bent-over row': 'remo inclinado',
  'pendlay': 'Pendlay',
  'row': 'remo',
  'reverse fly': 'apertura inversa',
  'reverse-grip fly': 'apertura con agarre inverso',
  'crossover': 'apertura cruzada',
  'butterfly': 'apertura',
  'fly': 'apertura',
  'biceps curl': 'curl de bíceps',
  'hammer curl': 'curl martillo',
  'concentration curl': 'curl concentrado',
  'preacher curl': 'curl predicador',
  'reverse curl': 'curl inverso',
  'reverse-grip curl': 'curl con agarre inverso',
  'wrist curl': 'curl de muñeca',
  'drag curl': 'curl arrastrado',
  'leg curl': 'curl de pierna',
  'hamstring curl': 'curl de isquiotibial',
  'curl': 'curl',
  'calf raise': 'elevación de talón',
  'leg raise': 'elevación de pierna',
  'knee raise': 'elevación de rodilla',
  'lateral raise': 'elevación lateral',
  'front raise': 'elevación frontal',
  'rear delt raise': 'elevación del deltoide posterior',
  'shoulder raise': 'elevación de hombro',
  'y-raise': 'elevación en Y',
  'raise': 'elevación',
  'shrug': 'encogimiento',
  'front squat': 'sentadilla frontal',
  'back squat': 'sentadilla trasera',
  'sumo squat': 'sentadilla sumo',
  'hack squat': 'sentadilla hack',
  'split squat': 'sentadilla split',
  'bench squat': 'sentadilla en banco',
  'speed squat': 'sentadilla rápida',
  'wide squat': 'sentadilla abierta',
  'squat': 'sentadilla',
  'lunge': 'zancada',
  'reverse lunge': 'zancada hacia atrás',
  'walking lunge': 'zancadas caminando',
  'side lunge': 'zancada lateral',
  'romanian deadlift': 'peso muerto rumano',
  'sumo deadlift': 'peso muerto sumo',
  'single leg deadlift': 'peso muerto a una pierna',
  'one leg deadlift': 'peso muerto a una pierna',
  'stiff leg deadlift': 'peso muerto con piernas rígidas',
  'straight leg deadlift': 'peso muerto con piernas extendidas',
  'deadlift': 'peso muerto',
  'good morning': 'buenos días',
  'hip thrust': 'empuje de cadera',
  'glute bridge': 'puente de glúteos',
  'hip lift': 'elevación de cadera',
  'bicycle crunch': 'abdominal bicicleta',
  'reverse crunch': 'abdominal inverso',
  'side crunch': 'abdominal lateral',
  'standing crunch': 'abdominal de pie',
  'kneeling crunch': 'abdominal arrodillado',
  'twisting crunch': 'abdominal con giro',
  'crunch': 'abdominal',
  'sit-up': 'abdominal',
  'v-up': 'v-up',
  'jackknife sit-up': 'abdominal tijera',
  'twist': 'giro',
  'side bend': 'flexión lateral',
  'triceps extension': 'extensión de tríceps',
  'leg extension': 'extensión de pierna',
  'back extension': 'extensión de espalda',
  'hip extension': 'extensión de cadera',
  'skullcrusher': 'rompe cráneos',
  'skull crusher': 'rompe cráneos',
  'neck extension': 'extensión de cuello',
  'reverse extension': 'extensión invertida',
  'extension': 'extensión',
  'triceps dip': 'fondos de tríceps',
  'chest dip': 'fondos de pecho',
  'bench dip': 'fondos en banco',
  'dip': 'fondos',
  'triceps kickback': 'extensión posterior de tríceps',
  'kickback': 'extensión posterior',
  'plank': 'plancha',
  'bridge': 'puente',
  'burpee': 'burpee',
  'sprint': 'esprint',
  'skater': 'patinador',
  'sled drag': 'arrastre de trineo',
  'sled push': 'empuje de trineo',
  'wall ball': 'medicine ball contra la pared',
  'medicine ball': 'medicine ball',
  'clean and press': 'clean y press',
  'clean': 'clean',
  'snatch': 'snatch',
  'jerk': 'jerk',
  'thruster': 'thruster',
  'bottoms-up': 'giro de kettlebell',
  'biceps leg concentration curl': 'curl concentrado de bíceps',
  'adduction': 'aducción',
  'abduction': 'abducción',
  'internal rotation': 'rotación interna',
  'external rotation': 'rotación externa',
  'rotation': 'rotación',
  'twisting': 'giro',
  'pronation': 'pronación',
  'supination': 'supinación',
  'squeeze': 'apretón',
  'isometric': 'isométrico',
  'stretch': 'estiramiento',
  'neck stretch': 'estiramiento de cuello',
  'hamstring stretch': 'estiramiento de isquiotibial',
  'quadriceps stretch': 'estiramiento de cuádriceps',
  'pectoralis stretch': 'estiramiento de pectoral',
  'chest stretch': 'estiramiento de pecho',
  'back stretch': 'estiramiento de espalda',
  'side stretch': 'estiramiento lateral',
  'hip flexor stretch': 'estiramiento de flexor de cadera',
  'triceps stretch': 'estiramiento de tríceps',
  'biceps stretch': 'estiramiento de bíceps',
  'calf stretch': 'estiramiento de talón',
  'shoulder stretch': 'estiramiento de hombro',
  'ankle stretch': 'estiramiento de tobillo',
  'wrist stretch': 'estiramiento de muñeca',
  'butt-ups': 'glúteos arriba',
  'butt ups': 'glúteos arriba',
  'superman': 'superman',
  'swimmer': 'nadador',
  'hollow body': 'hueco corporal',
  'handstand': 'supporto de manos',
  'planche': 'plancha horizontal',
  'pike': 'pique',
  'push sit-up': 'abdominal con empuje',
  'press sit-up': 'abdominal con press',
  'clap': 'Palmada',
  'bike': 'bicicleta',
  'air bike': 'bicicleta de aire',
  'elliptical': 'elíptica',
  'treadmill': 'cinta de correr',
  'stepmill': 'escaladora',
  'rowing': 'remo en máquina',
  'ski erg': 'ski erg',
  'staircase': 'escalera',
  'step': 'escalón',
  'jump': 'salto',
  'hop': 'salto',
  'sprint jumps': 'saltos de esprint',
  'high pulley overhead tricep extension': 'extensión de tríceps en polea alta',
  't raise': 'elevación en T',
  't bar row': 'remo en barra T',
  't bar': 'barra T',
  't-raise': 'elevación en T',
}

/* --------------------------------------------------------------- modifiers -- */
// Modifier → [Spanish, priority]. The priority is the Spanish order:
// variation (0) → position (1) → technique (2) → angle (3).
const MODIFIERS = {
  'alternating': ['alternante', 0],
  'alternate': ['alterno', 0],
  'single leg': ['a una pierna', 0],
  'one leg': ['a una pierna', 0],
  'single': ['simple', 0],
  'one arm': ['unilateral', 0],
  'one': ['una', 0],
  'two': ['bilateral', 0],
  'both': ['ambos', 0],
  'double': ['doble', 0],
  'full': ['completo', 0],
  'partial': ['parcial', 0],
  'quick': ['rápido', 0],
  'fast': ['rápido', 0],
  'heavy': ['pesado', 0],
  'weighted': ['con carga', 0],
  'assisted': ['asistido', 0],
  'standing': ['de pie', 1],
  'seated': ['sentado', 1],
  'sitted': ['sentado', 1],
  'kneeling': ['arrodillado', 1],
  'lying': ['tumbado', 1],
  'prone': ['boca abajo', 1],
  'supine': ['boca arriba', 1],
  'hanging': ['colgado', 1],
  'inverted': ['invertido', 1],
  'sitting': ['sentado', 1],
  'upright': ['vertical', 1],
  'bent knee': ['con rodillas flexionadas', 1],
  'bent arm': ['con brazos flexionados', 1],
  'bent over': ['inclinado', 2],
  'bent-over': ['inclinado', 2],
  'reverse': ['inverso', 2],
  'reversed': ['inverso', 2],
  'close grip': ['con agarre cerrado', 2],
  'close-grip': ['con agarre cerrado', 2],
  'reverse grip': ['con agarre inverso', 2],
  'reverse-grip': ['con agarre inverso', 2],
  'underhand grip': ['con agarre supinado', 2],
  'overhand grip': ['con agarre prono', 2],
  'overhead grip': ['con agarre prono', 2],
  'wide grip': ['con agarre abierto', 2],
  'wide-grip': ['con agarre abierto', 2],
  'wide': ['abierto', 3],
  'narrow grip': ['con agarre estrecho', 2],
  'narrow-grip': ['con agarre estrecho', 2],
  'neutral grip': ['con agarre neutro', 2],
  'underhand': ['con agarre supinado', 2],
  'overhand': ['con agarre prono', 2],
  'grip': ['agarre', 2],
  'behind head': ['detrás de la cabeza', 2],
  'behind neck': ['detrás del cuello', 2],
  'on the floor': ['en el suelo', 2],
  'on floor': ['en el suelo', 2],
  'floor': ['en el suelo', 2],
  'on bench': ['en banco', 2],
  'on stability ball': ['sobre la pelota', 2],
  'on exercise ball': ['sobre la pelota', 2],
  'with towel': ['con toalla', 2],
  'with rope': ['con cuerda', 2],
  'with arm blaster': ['con blaster', 2],
  'with band': ['con banda', 2],
  'with v-bar': ['con barra V', 2],
  'with resistance band': ['con banda elástica', 2],
  'with battle ropes': ['con cuerdas de combate', 2],
  'overhead': ['sobre la cabeza', 2],
  'overhead tricep extension': ['extensión de tríceps sobre la cabeza', 2],
  'front': ['frontal', 3],
  'rear': ['posterior', 3],
  'back': ['trasero', 3],
  'side': ['lateral', 3],
  'lateral': ['lateral', 3],
  'straight': ['recto', 3],
  'incline': ['inclinado', 3],
  'decline': ['declinado', 3],
  'flat': ['plano', 3],
  'horizontal': ['horizontal', 3],
  'vertical': ['vertical', 3],
  'diagonal': ['diagonal', 3],
  'high': ['alto', 3],
  'low': ['bajo', 3],
  'upper': ['superior', 3],
  'lower': ['inferior', 3],
  'inner': ['interno', 3],
  'outer': ['externo', 3],
  'left': ['izquierdo', 3],
  'right': ['derecho', 3],
  'around the world': ['al-around del mundo', 3],
  'cross': ['cruzado', 3],
  'outstretched': ['estirado', 3],
  'upward': ['hacia arriba', 3],
  'downward': ['hacia abajo', 3],
  'up': ['hacia arriba', 3],
  'down': ['hacia abajo', 3],
  'out': ['hacia fuera', 3],
  'male': ['hombre', 3],
  'female': ['mujer', 3],
  'arm': ['brazo', 3],
  'arms': ['brazos', 3],
  'leg': ['pierna', 3],
  'legs': ['piernas', 3],
  'knee': ['rodilla', 3],
  'knees': ['rodillas', 3],
  'elbow': ['codo', 3],
  'wrist': ['muñeca', 3],
  'ankle': ['tobillo', 3],
  'toe': ['punta del pie', 3],
  'toes': ['puntas de los pies', 3],
  'calf': ['talón', 3],
  'calves': ['talones', 3],
  'hand': ['mano', 3],
  'hands': ['manos', 3],
  'palms': ['palmas', 3],
  'chest': ['pecho', 3],
  'shoulder': ['hombro', 3],
  'hip': ['cadera', 3],
  'body': ['cuerpo', 3],
  'head': ['cabeza', 3],
  'feet': ['pies', 3],
  'leggings': ['piernas', 3],
  // The long tail of the catalogue: body parts, angles, brands and the words
  // the movements are qualified with. They all read as modifiers, so they
  // close the Spanish name after the movement.
  'press': ['press', 0],
  'pushdown': ['pressdown', 0],
  'presses': ['press', 0],
  'push': ['empuje', 0],
  'pull': ['tirón', 0],
  'dips': ['fondos', 0],
  'curls': ['curl', 0],
  'raises': ['elevación', 0],
  'jumps': ['saltos', 0],
  'kicks': ['patadas', 0],
  'hops': ['saltos', 0],
  'twists': ['giros', 0],
  'crossovers': ['aperturas cruzadas', 0],
  'squats': ['sentadillas', 0],
  'flyes': ['aperturas', 0],
  'kickbacks': ['extensiones posteriores', 0],
  'thrusts': ['empujes', 0],
  'crunches': ['abdominales', 0],
  'bends': ['flexiones', 0],
  'ups': ['tiros', 0],
  'exercise': ['', 3],
  'sit': ['', 3],
  'bench': ['banco', 3],
  'benches': ['bancos', 3],
  'ball': ['pelota', 3],
  'stability ball': ['pelota de estabilidad', 3],
  'stability': ['estabilidad', 3],
  'ez': ['barra EZ', 3],
  'bar': ['barra', 3],
  'bars': ['barras', 3],
  'bicep': ['bíceps', 3],
  'tricep': ['tríceps', 3],
  'triceps': ['tríceps', 3],
  'biceps': ['bíceps', 3],
  'hammer': ['martillo', 3],
  'rope': ['cuerda', 3],
  'ropes': ['cuerdas', 3],
  'delt': ['deltoide', 3],
  'deltoid': ['deltoide', 3],
  'roller': ['con rodillo', 3],
  'rollerout': ['rodillo', 3],
  'rollerer': ['rodillo', 3],
  'hack': ['en máquina hack', 3],
  'parallel': ['paralelo', 3],
  'touch': ['toque', 3],
  'wall': ['pared', 3],
  'run': ['carrera', 3],
  'runner': ['carrera', 3],
  'runners': ['corredores', 3],
  'inverse': ['inverso', 3],
  'forward': ['hacia adelante', 3],
  'lat': ['dorsal', 3],
  'throw': ['lanzamiento', 3],
  'revers': ['inverso', 3],
  'palm': ['palma', 3],
  'spider': ['araña', 3],
  'muscle': ['músculo', 3],
  'suspended': ['suspendido', 3],
  'wheel': ['rueda', 3],
  'narrow': ['estrecho', 3],
  'stance': ['posición', 3],
  'bent': ['flexionado', 3],
  'against': ['contra', 3],
  'chin': ['mentón', 3],
  'kick': ['patada', 3],
  'hyperextension': ['hiperextensión', 3],
  'hyper': ['hiperextensión', 3],
  'hang': ['colgado', 3],
  'swing': ['swing', 3],
  'archer': ['arquero', 3],
  'jack': ['jack', 3],
  'drop': ['caída', 3],
  'fallout': ['caída', 3],
  'squatting': ['en sentadilla', 3],
  'pose': ['pose', 3],
  'lift': ['elevación', 3],
  'extended': ['extendido', 3],
  'tap': ['toque', 3],
  'raised': ['elevado', 3],
  'twisted': ['girado', 3],
  'support': ['apoyo', 3],
  'supported': ['con apoyo', 3],
  'oblique': ['oblicuo', 3],
  'obique': ['oblicuo', 3],
  'scapula': ['escápula', 3],
  'scapular': ['escapular', 3],
  'flexor': ['flexor', 3],
  'donkey': ['burro', 3],
  'pelvic': ['pélvico', 3],
  'tilt': ['inclinación', 3],
  'reach': ['alcance', 3],
  'walking': ['caminando', 3],
  'piriformis': ['piriforme', 3],
  'hamstring': ['isquiotibial', 3],
  'balance': ['equilibrio', 3],
  'fixed': ['fijo', 3],
  'bradford': ['Bradford', 3],
  'rocky': ['Rocky', 3],
  'rocking': ['Rocky', 3],
  'bottoms': ['giro', 3],
  'rotational': ['rotacional', 3],
  'tuck': ['recogida', 3],
  'chair': ['silla', 3],
  'trainer': ['entrenador', 3],
  'around': ['alrededor', 3],
  'stork': ['cigüeña', 3],
  'cuban': ['cubano', 3],
  'finger': ['dedo', 3],
  'fingers': ['dedos', 3],
  'iron': ['hierro', 3],
  'world': ['mundo', 3],
  'sumo': ['sumo', 3],
  'off': ['fuera', 3],
  'hug': ['abrazo', 3],
  'tennis': ['tenis', 3],
  'flexion': ['flexión', 3],
  'maltese': ['maltesa', 3],
  'glute': ['glúteo', 3],
  'glutes': ['glúteos', 3],
  'gluteus': ['glúteo', 3],
  'hack': ['hack', 3],
  'clasped': ['juntas', 3],
  'circular': ['circular', 3],
  'landmine': ['landmine', 3],
  'gripless': ['sin agarre', 3],
  'machine': ['máquina', 3],
  'point': ['punto', 3],
  'response': ['respuesta', 3],
  'slam': ['golpe', 3],
  'modified': ['modificado', 3],
  'olympic': ['olímpico', 3],
  'posterior': ['posterior', 3],
  'potty': ['orinal', 3],
  'power': ['potencia', 3],
  'depresor': ['depresor', 3],
  'retractor': ['retractor', 3],
  'sissy': ['sissy', 3],
  'ski': ['ski', 3],
  'spine': ['columna', 3],
  'stationary': ['fija', 3],
  'walk': ['caminata', 3],
  'straddle': ['a horcillas', 3],
  'astride': ['a horcillas', 3],
  'three': ['tres', 3],
  'rectus': ['recto', 3],
  'femoris': ['femoris', 3],
  'pectoralis': ['pectoral', 3],
  'major': ['mayor', 3],
  'adductor': ['aductor', 3],
  'forth': ['hacia atrás', 3],
  'pec': ['pectoral', 3],
  'backward': ['hacia atrás', 3],
  'board': ['tabla', 3],
  'bicycle': ['bicicleta', 3],
  'knife': ['cuchillo', 3],
  'skull': ['cráneo', 3],
  'lifting': ['levantamiento', 3],
  'pin': ['fijo', 3],
  'rack': ['rack', 3],
  'skier': ['esquiador', 3],
  'ab': ['abdominal', 3],
  'stiff': ['rígido', 3],
  'basic': ['básico', 3],
  'battling': ['combate', 3],
  'stabilization': ['estabilización', 3],
  'concentration': ['concentrado', 3],
  'variation': ['variación', 3],
  'middle': ['medio', 3],
  'drive': ['empuje', 3],
  'elevated': ['elevado', 3],
  'russian': ['ruso', 3],
  'thibaudeau': ['Thibaudeau', 3],
  'kayak': ['kayac', 3],
  'cambered': ['camberado', 3],
  'cage': ['jaula', 3],
  'circles': ['círculos', 3],
  'clock': ['reloj', 3],
  'cocoons': ['capullos', 3],
  'crab': ['cangrejo', 3],
  'curtsey': ['curtsé', 3],
  'cycle': ['ciclo', 3],
  'deep': ['profundo', 3],
  'diamond': ['diamante', 3],
  'bowling': ['béisbol', 3],
  'contralateral': ['contralateral', 3],
  'can': ['lata', 3],
  'breeding': ['cría', 3],
  'across': ['a través de', 3],
  'face': ['cara', 3],
  'external': ['externo', 3],
  'femoral': ['femoral', 3],
  'pronated': ['pronado', 3],
  'supinated': ['supinado', 3],
  'peacher': ['predicador', 3],
  'pronate': ['pronar', 3],
  'scott': ['Scott', 3],
  'rotate': ['rotar', 3],
  'carry': ['con carga', 3],
  'stepbox': ['escalón', 3],
  'waiter': ['camarero', 3],
  'dynamic': ['dinámico', 3],
  'elevator': ['elevador', 3],
  'ground': ['suelo', 3],
  'pyramid': ['pirámide', 3],
  'ankles': ['tobillos', 3],
  'legged': ['con piernas', 3],
  'anti': ['anti', 3],
  'gravity': ['gravedad', 3],
  'flag': ['bandera', 3],
  'flutter': ['flutter', 3],
  'frankenstein': ['Frankenstein', 3],
  'reps': ['repeticiones', 3],
  'gironda': ['Gironda', 3],
  'sternum': ['esternón', 3],
  'ham': ['isquio', 3],
  'gorilla': ['gorila', 3],
  'groin': ['ingle', 3],
  'keens': ['piernas', 3],
  'impossible': ['imposible', 3],
  'depth': ['profundidad', 3],
  'intermediate': ['intermedio', 3],
  'quad': ['cuádriceps', 3],
  'quads': ['cuádriceps', 3],
  'straps': ['correas', 3],
  'wipers': ['limpiaparabrisas', 3],
  'jackknife': ['tijera', 3],
  'janda': ['Janda', 3],
  'advanced': ['avanzado', 3],
  'renegade': ['renegada', 3],
  'position': ['posición', 3],
  'figure': ['figura', 3],
  'pirate': ['pirata', 3],
  'supper': ['cena', 3],
  'pistol': ['pistola', 3],
  'turkish': ['turco', 3],
  'get': ['levantamiento', 3],
  'style': ['estilo', 3],
  'kipping': ['con impulso', 3],
  'korean': ['coreano', 3],
  'lean': ['inclinado', 3],
  'hook': ['gancho', 3],
  'boxing': ['boxeo', 3],
  'gripper': ['potenciador', 3],
  'rotary': ['rotatorio', 3],
  'pad': ['colchón', 3],
  'unilateral': ['unilateral', 3],
  'london': ['Londres', 3],
  'catch': ['agarre', 3],
  'multiple': ['múltiple', 3],
  'release': ['soltar', 3],
  'mixed': ['mixto', 3],
  'hindu': ['hindú', 3],
  'neck': ['cuello', 3],
  'negative': ['negativo', 3],
  'medicine': ['medicine', 3],
  'otis': ['Otis', 3],
  'outside': ['exterior', 3],
  'peroneals': ['peroneos', 3],
  'cobra': ['cobra', 3],
  'tibialis': ['tibial', 3],
  'prisoner': ['prisionero', 3],
  'inside': ['interior', 3],
  'plus': ['más', 3],
  'quarter': ['cuarto', 3],
  'reclining': ['reclinado', 3],
  'big': ['grande', 3],
  'ring': ['anillo', 3],
  'saw': ['sierra', 3],
  'climb': ['trepar', 3],
  'angle': ['ángulo', 3],
  'sequence': ['secuencia', 3],
  'semi': ['semi', 3],
  'short': ['corto', 3],
  'stride': ['zancada', 3],
  'platform': ['plataforma', 3],
  'slide': ['deslizar', 3],
  'ergometer': ['ergómetro', 3],
  'skin': ['piel', 3],
  'cat': ['gato', 3],
  'degrees': ['grados', 3],
  'closer': ['más cerca', 3],
  'angled': ['inclinado', 3],
  'sledge': ['trineo', 3],
  'caster': ['rueda', 3],
  'sphinx': ['esfinge', 3],
  'crawl': ['arrastre', 3],
  'stalder': ['Stalder', 3],
  'strap': ['correa', 3],
  'star': ['estrella', 3],
  'abductor': ['abductor', 3],
  'abdominal': ['abdominal', 3],
  'tire': ['neumático', 3],
  'trap': ['trapecio', 3],
  'twin': ['gemelo', 3],
  'handle': ['agarre', 3],
  'facing': ['de frente', 3],
  'dog': ['perro', 3],
  'cossack': ['cosaco', 3],
  'round': ['redondo', 3],
  'wind': ['viento', 3],
  'sprints': ['esprints', 3],
  'greatest': ['greatest', 3],
  'spell': ['hechizo', 3],
  'wolf': ['lobo', 3],
  // The equipment can also sit inside the name ("ez barbell anti gravity
  // press"), not only in front of it.
  'barbell': ['con barra', 3],
  'dumbbell': ['con mancuernas', 3],
  'dumbbells': ['con mancuernas', 3],
  'kettlebell': ['con kettlebell', 3],
  'cable': ['en polea', 3],
  'smith': ['máquina smith', 3],
  'machine': ['máquina', 3],
  'ez': ['barra EZ', 3],
  'bosu': ['bosu', 3],
  'bodyweight': ['a peso corporal', 3],
  'band': ['banda elástica', 3],
  'towel': ['toalla', 3],
  'lever': ['palanca', 3],
  'sled': ['trineo', 3],
  // The remaining proper nouns and qualifiers of the long tail.
  'zottman': ['Zottman', 3],
  'plyo': ['pliométrica', 3],
  'frog': ['rana', 3],
  'half': ['medio', 3],
  'self': ['autoejercicio', 3],
  'slingers': ['lanzadores', 3],
  'motion': ['movimiento', 3],
  'neutral': ['neutro', 3],
  'pass': ['pase', 3],
  'captains': ['capitán', 3],
  'above': ['sobre', 3],
  'march': ['marcha', 3],
  'range': ['rango', 3],
  'scissor': ['tijera', 3],
  'split': ['split', 3],
  'flip': ['volteo', 3],
}

/* ----------------------------------------------------------------- special -- */
// Whole names the dictionaries cannot render well: proper nouns, branded
// variations and the names the catalogue gives to a specific movement.
const SPECIAL = {
  'all fours squad stretch': 'estiramiento de cd(Note) cuadrilátero',
  'alternate heel touchers': 'toques de talón alternados',
  'alternate lateral pulldown': 'jalón lateral alternado',
  'ankle circles': 'círculos de tobillo',
  'arms apart circular toe touch (male)': 'toque circular de punta con brazos separados (hombre)',
  'arms overhead full sit-up (male)': 'abdominal completo con brazos arriba (hombre)',
  'assisted chest dip (kneeling)': 'fondos de pecho asistidos (arrodillado)',
  'back extension on exercise ball': 'extensión de espalda sobre la pelota',
  'back lever': 'palanca trasera',
  'banded good morning': 'buenos días con banda',
  'biceps leg concentration curl': 'curl concentrado de bíceps',
  'bodyweight good morning': 'buenos días a peso corporal',
  'bosu side crunch': 'abdominal lateral con bosu',
  'bottoms up kettlebell': 'giro de kettlebell',
  'butt ups': 'glúteos arriba',
  'cable pull through': 'trazón en polea',
  'cable rear delt row': 'remo deltoide posterior en polea',
  'cable skull crusher': 'rompe cráneos en polea',
  'cable straight arm pulldown': 'jalón con brazo recto en polea',
  'cable v raise': 'elevación en V en polea',
  'calf circle': 'círculos de talón',
  'calf pull through': 'trazón de talón',
  'captain chair': 'silla de capitán',
  'chest dip (kneeling)': 'fondos de pecho (arrodillado)',
  'chest supported row': 'remo con apoyo pectoral',
  'chest-supported row': 'remo con apoyo pectoral',
  'clap push-up': 'flexión con palmada',
  'close-grip skull crusher': 'rompe cráneos con agarre cerrado',
  'compound row': 'remo compuesto',
  'crocodile push-up': 'flexión cocodrilo',
  'cross body crunch': 'abdominal cruzado',
  'cross body pull': 'tirón cruzado',
  'diamond push-up': 'flexión diamante',
  'donkey calf raise': 'elevación de talón con pie apoyado',
  'double barbell full squat': 'sentadilla completa con doble barra',
  'double barbell good morning': 'buenos días con doble barra',
  'drag curl': 'curl arrastrado',
  'dumbbell alt. row': 'remo alterno con mancuernas',
  'dumbbell around world': 'giro alrededor del mundo con mancuernas',
  'dumbbell double leg calf raise': 'elevación de talón a dos piernas con mancuernas',
  'dumbbell single leg calf raise': 'elevación de talón a una pierna con mancuernas',
  'dumbbell zottman curl': 'curl Zottman con mancuernas',
  'explosive high knees': 'rodillas altas explosivas',
  'fast feet': 'pies rápidos',
  'flipped burpee': 'burpee volteado',
  'full range of motion': 'rango completo de movimiento',
  'glute bridge march': 'puente de glúteos con marcha',
  'good morning': 'buenos días',
  'gripper': 'potenciador de agarre',
  'hack squat one leg': 'sentadilla hack a una pierna',
  'half kneeling': 'medio arrodillado',
  'heel circle': 'círculos de talón',
  'high knee run': 'carrera con rodillas altas',
  'incline side plank': 'plancha lateral inclinada',
  'isometric plank': 'plancha isométrica',
  'jackknife sit-up': 'abdominal tijera',
  'kettlebell bottom position': 'kettlebell en posición baja',
  'knee circle': 'círculos de rodilla',
  'korean dip': 'fondos coreanos',
  'landmine squat': 'sentadilla landmine',
  'lying leg curl': 'curl de pierna tumbado',
  'monster walk': 'caminata del monstruo',
  'overhead squat': 'sentadilla sobre la cabeza',
  'pike push-up': 'flexión pique',
  'pull through': 'trazón',
  'rack pull': 'tirón desde rack',
  'rotational medicine ball throw': 'lanzamiento rotacional de medicine ball',
  'runner': 'carrera',
  'scorpion stretch': 'estiramiento escorpión',
  'shoulder tap': 'toque de hombro',
  'side plank': 'plancha lateral',
  'single arm push-up': 'flexión unilateral',
  'skater': 'patinador',
  'snatch grip': 'agarre de snatch',
  'spider man': 'hombre araña',
  'spiderman': 'hombre araña',
  'split squat': 'sentadilla split',
  'starfish': 'estrella de mar',
  'suitcase carry': 'caminata estilo maleta',
  'swimmer': 'nadador',
  'tuck jump': 'salto con recogida',
  'upright row': 'remo vertical',
  'v-up': 'v-up',
  'wall sit': 'sentadilla contra la pared',
  'windmill': 'molino',
  'y-raise': 'elevación en Y',
  't raise': 'elevación en T',
  'dumbbell incline t-raise': 'Elevación en T inclinada con mancuernas',
  'hyght dumbbell fly': 'Apertura con mancuernas',
  'lever reverse t-bar row': 'Remo inverso en barra T con palanca',
  'lever t bar row': 'Remo en barra T con palanca',
  'lever t-bar reverse grip row': 'Remo en barra T con agarre inverso con palanca',
}

// The whole names are looked up in their normalized form, so a key written
// with hyphens ("close-grip skull crusher") still finds its name.
const SPECIAL_INDEX = new Map(Object.entries(SPECIAL).map(([k, v]) => [normalize(k), v]))

/* ------------------------------------------------------------- translation -- */

// A key may be written with hyphens ("pull-up"); the name arrives with spaces
// ("pull up"), so both are read as the same list of words.
const keyTokens = key => key.split(/[\s-]+/).filter(Boolean)

const byLength = dict => Object.keys(dict).sort((a, b) => b.length - a.length)

// Pre-sorted keys: the match is always the longest phrase first.
const EQUIPMENT_KEYS = byLength(EQUIPMENT)
const MOVEMENT_KEYS = byLength(MOVEMENTS)
const MODIFIER_KEYS = byLength(MODIFIERS)

// A name can hold a parenthetical ("(male)", "(with towel)"): it stays at the
// end of the Spanish name, translated word by word.
const PAREN_WORDS = {
  with: 'con',
  male: 'hombre',
  female: 'mujer',
  towel: 'toalla',
  rope: 'cuerda',
  band: 'banda',
  arm: 'brazo',
  blaster: 'blaster',
  bar: 'barra',
  'v-bar': 'barra V',
  knees: 'rodillas',
  bent: 'flexionadas',
  leg: 'pierna',
  both: 'ambas',
  legs: 'piernas',
  under: 'bajo',
  shoulder: 'hombro',
  body: 'cuerpo',
  side: 'lateral',
  full: 'completo',
  range: 'rango',
  of: 'de',
  motion: 'movimiento',
  back: 'trasera',
  pov: 'vista',
  side: 'lateral',
}

// The English glue words: they carry no meaning of their own, only order.
const GLUE = new Set(['the', 'a', 'an', 'and', 'of', 'to', 'from', 'in', 'on', 'with', 'at', 'by', 'for', 'per', 'vs', 'v', 'v2', 'v3', 'x', 'is', 'as', 'into', 'over', 'under', 'between', 'through', 'about', 'your', 's', '°', 'l', 'w'])

function normalize(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9°'()\/\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function translateParen(text) {
  return text
    .split(/\s+/)
    .map(w => {
      const key = w.replace(/[^a-z0-9-]/g, '')
      if (!key) return ''
      return PAREN_WORDS[key] || key
    })
    .filter(Boolean)
    .join(' ')
}

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
}

// The gender of a Spanish movement: the head noun decides it ("sentadilla" is
// feminine, "remo" is masculine). Words ending in "-ía" are exceptions.
function movementIsFeminine(es) {
  const head = (String(es || '').trim().split(' ')[0] || '').toLowerCase()
  if (!head) return false
  // "-ción" nouns are feminine ("elevación", "extensión", "rotación").
  if (/ción$/.test(head)) return true
  return /a$/.test(head)
}

/**
 * Translate one catalogue name into Spanish.
 *
 * @param {string} en The English name from the catalogue
 * @returns {string} The Spanish name (falls back to the English one when the
 *   dictionaries cannot read the name at all — the test reports every such
 *   case so nothing slips through unnoticed)
 */
export function translateExerciseName(en) {
  const raw = String(en || '').trim()
  if (!raw) return ''
  let lower = normalize(raw)
  if (!lower) return raw

  const special = SPECIAL_INDEX.get(lower)
  if (special) return special

  // Parentheses ride along at the end.
  let paren = ''
  const parenMatch = lower.match(/\(([^)]*)\)/g)
  if (parenMatch) {
    paren = parenMatch
      .map(p => translateParen(p.replace(/[()]/g, '')))
      .filter(Boolean)
      .map(p => `(${p})`)
      .join(' ')
    lower = lower.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
  }

  let rest = lower
  let equipment = ''
  for (const key of EQUIPMENT_KEYS) {
    if (rest === key) { equipment = EQUIPMENT[key]; rest = ''; break }
    if (rest.startsWith(key + ' ')) {
      equipment = EQUIPMENT[key]
      rest = rest.slice(key.length).trim()
      break
    }
  }

  const tokens = rest.split(' ').filter(Boolean)
  const movements = []
  const modifiers = []
  const unknown = []

  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]

    // A movement phrase (longest match first).
    let matched = null
    for (const key of MOVEMENT_KEYS) {
      const parts = keyTokens(key)
      if (parts.length <= tokens.length - i && parts.every((p, k) => tokens[i + k] === p)) {
        matched = key
        break
      }
    }
    if (matched) {
      movements.push(MOVEMENTS[matched])
      i += keyTokens(matched).length
      continue
    }

    // A modifier phrase.
    let mod = null
    for (const key of MODIFIER_KEYS) {
      const parts = keyTokens(key)
      if (parts.length <= tokens.length - i && parts.every((p, k) => tokens[i + k] === p)) {
        mod = key
        break
      }
    }
    if (mod) {
      modifiers.push({ text: MODIFIERS[mod][0], priority: MODIFIERS[mod][1] })
      i += keyTokens(mod).length
      continue
    }

    if (GLUE.has(token)) { i++; continue }
    // A version marker ("v. 2") is noise in the name: the movement is the same.
    if (/^\d+(\/\d+)?°?$/.test(token) && tokens[i - 1] === 'v') { i++; continue }
    if (/^\d+(\/\d+)?°?$/.test(token)) { modifiers.push({ text: token, priority: 3 }); i++; continue }
    unknown.push(token)
    i++
  }

  // Spanish order: the movement first, then the modifiers by priority.
  modifiers.sort((a, b) => a.priority - b.priority)
  // The modifiers agree with the movement in gender ("sentadilla completa",
  // "remo inclinado").
  const feminine = movementIsFeminine(movements[0] || '')
  const modifierTexts = modifiers.map(m => (feminine && FEMININE[m.text]) || m.text)
  const pieces = [...movements, ...modifierTexts]
  const body = pieces.filter(Boolean).join(' ').trim()
  const withEquipment = equipment ? (body ? `${body} ${equipment}` : equipment) : body
  const name = capitalize([withEquipment, paren].filter(Boolean).join(' '))

  // Nothing understood → keep the original (and let the test shout about it).
  if (!name) return raw
  if (!movements.length && unknown.length === 0 && !body) return raw
  return name
}

// Words the dictionaries could not read — exported for the test that keeps the
// catalogue honest.
export function unknownWordsIn(name) {
  let lower = normalize(name)
  if (SPECIAL_INDEX.has(lower)) return []
  // The parenthetical travels at the end of the name; its words are checked on
  // their own (the PAREN_WORDS table), not against the movement dictionary.
  lower = lower.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
  let rest = lower
  for (const key of EQUIPMENT_KEYS) {
    if (rest.startsWith(key + ' ')) { rest = rest.slice(key.length).trim(); break }
  }
  const tokens = rest.split(' ').filter(Boolean)
  const unknown = []
  let i = 0
  while (i < tokens.length) {
    let matched = false
    for (const key of [...MOVEMENT_KEYS, ...MODIFIER_KEYS]) {
      const parts = keyTokens(key)
      if (parts.length <= tokens.length - i && parts.every((p, k) => tokens[i + k] === p)) {
        i += parts.length
        matched = true
        break
      }
    }
    if (matched) continue
    const token = tokens[i]
    if (!GLUE.has(token) && !/^\d+(\/\d+)?°?$/.test(token)) unknown.push(token)
    i++
  }
  return unknown
}

export default translateExerciseName
