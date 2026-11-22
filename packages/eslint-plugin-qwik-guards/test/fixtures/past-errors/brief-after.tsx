// Reduced from 633726a2:src/components/onboarding/anti-tabula-rasa.tsx.
import { DossierFolio } from "./dossier-folio";
export const after = (strength: number) =>
  DossierFolio({
    strength,
    leaf: <input value="draft" />,
  });
