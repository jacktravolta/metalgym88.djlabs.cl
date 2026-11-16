// The welcome bonus reported by the platform.
//
// The platform owns the ledger and now tells the front what happened:
// { credits_added, already_awarded }. Until that field is deployed, the front
// stays neutral — it never promises an amount the response did not confirm.
import { t } from '../i18n.js'

export function readWelcomeBonus(response) {
  const raw = response && typeof response === 'object'
    ? (response.welcome_bonus || (response.data && response.data.welcome_bonus))
    : null
  if (!raw || typeof raw !== 'object') return null

  const creditsAdded = Number(raw.credits_added)
  if (!Number.isFinite(creditsAdded) || creditsAdded < 0) return null

  return {
    creditsAdded,
    alreadyAwarded: raw.already_awarded === true,
  }
}

// The copy follows the ledger, never an assumption:
//   · credits added     → confirm the amount that arrived
//   · already awarded   → say the credits are already there
//   · field absent      → say only what is true and point to the visible balance
export function welcomeBonusMessage(bonus) {
  if (!bonus) {
    return t('You can see your current credit balance in the panel’s wallet.')
  }
  if (bonus.creditsAdded > 0) {
    return bonus.creditsAdded === 1
      ? t('1 welcome credit was added to your balance. You can use it with the AI coach.')
      : t('{0} welcome credits were added to your balance. You can use them with the AI coach.', bonus.creditsAdded)
  }
  if (bonus.alreadyAwarded) {
    return t('The welcome credits are already in your balance. There is nothing else to do.')
  }
  return t('You can see your current credit balance in the panel’s wallet.')
}
