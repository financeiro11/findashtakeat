import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string | null;
}

export function PdfOriginalDialog({ open, onOpenChange, url }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[85vh] p-0 flex flex-col">
        <DialogHeader className="p-4 border-b flex flex-row items-center justify-between">
          <DialogTitle>Documento original anexado</DialogTitle>
          {url && (
            <Button variant="outline" size="sm" asChild>
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 h-3.5 w-3.5" /> Abrir em nova aba
              </a>
            </Button>
          )}
        </DialogHeader>
        <div className="flex-1 overflow-hidden">
          {url ? (
            <iframe src={url} title="PDF" className="w-full h-full border-0" />
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              Nenhum PDF disponível.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
