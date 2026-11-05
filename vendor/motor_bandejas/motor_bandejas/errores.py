"""Excepciones del motor. Cada una lleva un código estable para que la UI/CAD pueda reaccionar sin parsear texto."""


class ErrorMotor(Exception):
    codigo = "ERROR_MOTOR"

    def __init__(self, mensaje: str, *, campo: str | None = None, codigo: str | None = None):
        super().__init__(mensaje)
        self.mensaje = mensaje
        self.campo = campo
        if codigo:
            self.codigo = codigo

    def como_dict(self) -> dict:
        return {"codigo": self.codigo, "mensaje": self.mensaje, "campo": self.campo}


class ErrorEntrada(ErrorMotor):
    """Entrada inválida o incompleta. El cálculo no se realiza."""
    codigo = "ENTRADA_INVALIDA"


class DatoFaltante(ErrorMotor):
    """Falta un dato físico necesario (diámetro, masa, ancho...). Nunca se reemplaza por cero."""
    codigo = "DATO_FALTANTE"


class PendienteDecision(ErrorMotor):
    """El caso requiere una regla de producto que todavía no fue acordada."""
    codigo = "PENDIENTE_DECISION"

    def __init__(self, mensaje: str, *, decision_id: str, campo: str | None = None):
        super().__init__(mensaje, campo=campo)
        self.decision_id = decision_id

    def como_dict(self) -> dict:
        d = super().como_dict()
        d["decision_id"] = self.decision_id
        return d


class NoSoportado(ErrorMotor):
    """Caso fuera del alcance implementado (sin regla documentada)."""
    codigo = "NO_SOPORTADO"

    def __init__(self, mensaje: str, *, decision_id: str | None = None, campo: str | None = None):
        super().__init__(mensaje, campo=campo)
        self.decision_id = decision_id

    def como_dict(self) -> dict:
        d = super().como_dict()
        d["decision_id"] = self.decision_id
        return d
