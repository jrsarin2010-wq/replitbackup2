const WIZARD_KEY = "setup_wizard_done";
const WIZARD_STEP_KEY = "setup_wizard_step";
const WIZARD_DATA_KEY = "setup_wizard_data";

export { WIZARD_KEY, WIZARD_STEP_KEY, WIZARD_DATA_KEY };

export function isWizardDone(): boolean {
  return localStorage.getItem(WIZARD_KEY) === "true";
}

export function markWizardDone() {
  localStorage.setItem(WIZARD_KEY, "true");
  localStorage.removeItem(WIZARD_STEP_KEY);
  localStorage.removeItem(WIZARD_DATA_KEY);
}
