import hashlib
import json
import logging
from typing import Dict, Any, Optional

from Logic.nodes.base import BaseNode, NodeMetadata, NodeResult
from Logic.nodes.registry import register_node

logger = logging.getLogger(__name__)


@register_node
class TwilioNode(BaseNode):
    metadata = NodeMetadata(
        type="twilioNode",
        label="Twilio Notify",
        category="action",
        color="#F22F46",
        input_handles=["data"],
        output_handles=["data"],
        description=(
            "Send SMS, WhatsApp, or voice alerts via Twilio. "
            "Highlighted mode sends only the top-risk entity and deduplicates — "
            "no repeat alerts unless the entity changes."
        )
    )

    # Class-level fingerprint cache: cache_key → {fingerprint, entity_name}
    # Persists for the lifetime of the process; resets on gateway restart.
    _fingerprint_cache: Dict[str, Dict] = {}

    # ─────────────────────────────────────────────────────────────────────────
    def execute(self, inputs: Dict[str, Any], config: Dict[str, Any]) -> NodeResult:
        logger.info("[TwilioNode] ================== EXECUTION STARTED ==================")

        try:
            from twilio.rest import Client
        except ImportError:
            return NodeResult(
                success=False, outputs={},
                error="twilio package not installed. Run: pip install twilio"
            )

        # ── Credentials ──────────────────────────────────────────────────────
        account_sid = config.get("accountSid", "").strip()
        auth_token  = config.get("authToken",  "").strip()
        from_number = config.get("fromNumber", "").strip()
        to_number   = config.get("toNumber",   "").strip()
        channel     = config.get("channel", "sms")

        if not all([account_sid, auth_token, from_number, to_number]):
            return NodeResult(
                success=False, outputs={},
                error="Missing Twilio credentials or phone numbers."
            )

        # ── Collect entities ──────────────────────────────────────────────────
        entities = []
        for value in inputs.values():
            if isinstance(value, list):
                entities.extend([e for e in value if isinstance(e, dict)])
            elif isinstance(value, dict):
                entities.append(value)
        logger.info(f"[TwilioNode] Received {len(entities)} entities.")

        # ── Config ────────────────────────────────────────────────────────────
        send_mode   = config.get("sendMode", "highlighted")
        message_tpl = config.get("messageTemplate", "").strip() or \
            "⚠️ HVE-OS Alert\nEntity: {name}\nRisk: {_risk_score} ({_risk_level})"
        threshold   = float(config.get("riskThreshold", 70))

        # Cache key unique to this node's destination
        cache_key = f"{account_sid}:{from_number}:{to_number}"

        # ── Build send list ───────────────────────────────────────────────────
        sends = []  # list of (message_body, entity_or_None)

        if send_mode == "highlighted":
            # Pick the single highest-risk entity
            if not entities:
                logger.info("[TwilioNode] No entities. Nothing to send.")
                return NodeResult(success=True, outputs={"data": entities})

            top = max(entities, key=lambda e: float(e.get("_risk_score", 0)))
            fp  = self._fingerprint(top)
            cached = TwilioNode._fingerprint_cache.get(cache_key, {})

            if cached.get("fingerprint") == fp:
                name = top.get("name") or top.get("title") or top.get("_hve_id") or "entity"
                logger.info(f"[TwilioNode] Highlighted entity '{name}' unchanged — skipping.")
                # Surface skip status on the entity so the frontend can show it
                top["_twilio_status"]  = "skipped (unchanged)"
                top["_twilio_skipped"] = True
                return NodeResult(success=True, outputs={"data": entities})

            body = self._render(message_tpl, top)
            sends.append((body, top))
            # Store fingerprint immediately (before send) to avoid duplicates
            # even if a later step fails
            TwilioNode._fingerprint_cache[cache_key] = {
                "fingerprint": fp,
                "entity_name": top.get("name") or top.get("_hve_id") or "?",
                "score":       top.get("_risk_score"),
            }

        elif send_mode == "static":
            ctx = entities[0] if entities else {}
            sends.append((self._render(message_tpl, ctx), None))

        elif send_mode == "template":
            for entity in entities:
                sends.append((self._render(message_tpl, entity), entity))

        elif send_mode == "risk_filter":
            for entity in entities:
                if float(entity.get("_risk_score", 0)) >= threshold:
                    sends.append((self._render(message_tpl, entity), entity))
            logger.info(f"[TwilioNode] {len(sends)} entities breach threshold ({threshold}).")

        if not sends:
            logger.info("[TwilioNode] Nothing to send.")
            return NodeResult(success=True, outputs={"data": entities})

        # ── Fire Twilio ───────────────────────────────────────────────────────
        client = Client(account_sid, auth_token)
        failed = []

        for body, entity in sends:
            label = (entity.get("name") or entity.get("_hve_id") or "entity") if entity else "static"
            try:
                if channel == "whatsapp":
                    msg = client.messages.create(
                        body=body,
                        from_=f"whatsapp:{from_number}",
                        to=f"whatsapp:{to_number}"
                    )
                elif channel == "call":
                    msg = client.calls.create(
                        twiml=f"<Response><Say>{body}</Say></Response>",
                        from_=from_number,
                        to=to_number
                    )
                else:
                    msg = client.messages.create(
                        body=body,
                        from_=from_number,
                        to=to_number
                    )

                sid = getattr(msg, "sid", "N/A")
                logger.info(f"[TwilioNode] Sent for '{label}' — SID: {sid}")
                if entity is not None:
                    entity["_twilio_sid"]     = sid
                    entity["_twilio_status"]  = "sent"
                    entity["_twilio_skipped"] = False

            except Exception as ex:
                logger.error(f"[TwilioNode] Failed for '{label}': {ex}")
                failed.append(str(label))
                if entity is not None:
                    entity["_twilio_status"] = f"failed: {ex}"

        logger.info(f"[TwilioNode] Done. Sent: {len(sends) - len(failed)}, Failed: {len(failed)}")
        logger.info("[TwilioNode] ================== EXECUTION FINISHED ==================")

        return NodeResult(
            success=len(failed) == 0,
            outputs={"data": entities},
            error=f"Failed: {', '.join(failed)}" if failed else None
        )

    # ── Helpers ───────────────────────────────────────────────────────────────
    @staticmethod
    def _fingerprint(entity: dict) -> str:
        """
        MD5 of the entity's identity + risk fields.
        Changes when score, level, path, or name change.
        """
        key = {k: entity.get(k) for k in (
            "name", "title", "id", "_hve_id",
            "_risk_score", "_risk_level", "_path_score", "_hops"
        )}
        return hashlib.md5(
            json.dumps(key, sort_keys=True, default=str).encode()
        ).hexdigest()

    @staticmethod
    def _render(template: str, entity: dict) -> str:
        """
        Interpolate {field} and {parent.child} tokens from entity dict.
        Unknown tokens are left intact.
        """
        import re
        def replacer(m):
            parts = m.group(1).split(".")
            val = entity
            for p in parts:
                val = val.get(p) if isinstance(val, dict) else None
            return str(val) if val is not None else m.group(0)
        return re.sub(r'\{([\w.]+)\}', replacer, template)

    def validate_config(self, config: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        for field in ("accountSid", "authToken", "fromNumber", "toNumber"):
            if not config.get(field, "").strip():
                return False, f"'{field}' is required."
        return True, None
