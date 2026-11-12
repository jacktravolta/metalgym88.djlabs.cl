// The suite's fixed coordinates: the public deployment under test, the
// platform host and the heart every call is scoped to.
export const BASE_URL = (process.env.E2E_BASE_URL || 'https://metaigym88.djlabs.cl').replace(/\/+$/, '')
export const API_HOST = process.env.E2E_API_HOST || 'api.djlabs.cl'
export const HEART = 'metalgym88'

// The visible strings the suite looks for. They come from the product's own
// Spanish locale, so a wording change is a real signal, not a flake.
export const TEXT = {
  landingRegisterHeading: 'Crea tu cuenta',
  landingContactHeading: 'Escríbenos',
  contactName: '¿Cómo te llamas?',
  contactEmail: 'tu@correo.cl',
  contactMessage: 'Cuéntanos en qué te podemos ayudar.',
  contactSubmit: 'Enviar mensaje',
  contactConfirmation: 'Recibimos tu mensaje',
  registerName: 'Tu nombre',
  appEmail: 'Correo',
  registerSubmit: 'Crear mi cuenta gratis',
  loginSubmit: 'Iniciar sesión',
  terms: 'Acepto los Términos',
  linkSent: 'Revisa tu correo',
  magicLinkTitle: 'Enlace de acceso por correo',
  sendLink: 'Enviar el enlace',
  emailLinkInstead: 'Envíame un enlace de acceso por correo',
  signOut: 'Cerrar sesión',
  continueWithoutAccount: 'Continuar sin cuenta',
  wallet: 'Billetera',
  balance: 'créditos disponibles',
  limitsLine: 'Las recargas van de',
  topUpButton: 'CLP en créditos',
  exercises: 'Ejercicios',
  plan: 'Plan',
  stats: 'Progreso',
  history: 'Historial',
  settings: 'Ajustes',
  start: 'Empezar',
  startWithoutWeighing: 'Empezar sin pesarse',
  starterPlan: 'Cargar plan inicial',
  starterPlanToast: 'Plan inicial cargado',
  bodyWeight: 'Peso corporal',
  termsLink: 'Términos y Condiciones',
  privacyLink: 'Privacidad',
}
