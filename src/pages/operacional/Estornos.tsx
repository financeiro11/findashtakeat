import { Undo2 } from "lucide-react";
import SheetMirrorPage from "./SheetMirrorPage";

const SPREADSHEET_ID = "10A9YnskShPPZ2Xz9d-kN2SHCv-qN-48-94rQBbCNWIo";
const SHEET_NAME = "ESTORNOS";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit?gid=1062579993`;

export default function Estornos() {
  return (
    <SheetMirrorPage
      spreadsheetId={SPREADSHEET_ID}
      sheet={SHEET_NAME}
      sheetUrl={SHEET_URL}
      title="Estornos"
      description="Espelho da aba ESTORNOS da planilha de Churn. Edições aqui são gravadas direto na planilha — e vice-versa."
      Icon={Undo2}
    />
  );
}
