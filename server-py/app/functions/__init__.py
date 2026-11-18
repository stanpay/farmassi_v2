"""Edge Function 대체. 이름은 원래 것을 그대로 유지한다 — 프론트 호출부를 고치지 않기 위해서."""
from .approve_farm import approve_farm
from .bankda_account_status import bankda_account_status
from .bankda_ott import bankda_ott
from .confirm_deposit import confirm_deposit
from .create_order import create_order
from .farm_today_qty import farm_today_qty
from .kpost_shipment import kpost_shipment
from .match_deposit import match_deposit
from .match_farm_products import match_farm_products
from .epost_address import epost_address
from .juso_building import juso_building
from .naver_address import naver_address
from .parse_order_messages import parse_order_messages
from .scrape_deposits import scrape_deposits
from .send_push import send_push_fn
from .types import FnCtx, FnHandler, FnResult, fail, ok

FUNCTIONS: dict[str, FnHandler] = {
    "approve-farm": approve_farm,
    "bankda-account-status": bankda_account_status,
    "bankda-ott": bankda_ott,
    "confirm-deposit": confirm_deposit,
    "create-order": create_order,
    "epost-address": epost_address,
    "farm-today-qty": farm_today_qty,
    "juso-building": juso_building,
    "kpost-shipment": kpost_shipment,
    "match-deposit": match_deposit,
    "match-farm-products": match_farm_products,
    "naver-address": naver_address,
    "parse-order-messages": parse_order_messages,
    "scrape-deposits": scrape_deposits,
    "send-push": send_push_fn,
}
