import { Receipt } from "lucide-react";
import SheetMirrorPage from "./SheetMirrorPage";

const SPREADSHEET_ID = "1P7O1xRyrybuDQOfw3WIRkne15FOM7bBPMTWweMrCulA";
const SHEET_NAME = "Form Responses 1";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit?gid=2045888472`;

export default function Reembolsos() {
  return (
    <SheetMirrorPage
      spreadsheetId={SPREADSHEET_ID}
      sheet={SHEET_NAME}
      sheetUrl={SHEET_URL}
      title="Reembolsos"
      description="Espelho da planilha de reembolsos. Edições aqui são gravadas direto na planilha — e vice-versa."
      Icon={Receipt}
    />
  );
}
