"""
用户服务模块
"""

from app.services.users.auth_service import AuthService
from app.services.users.desktop_oauth_service import (
    DesktopOAuthError,
    DesktopOAuthService,
)
from app.services.users.invite_code_service import InviteCodeService
from app.services.users.registration_policy import RegistrationPolicy
from app.services.users.registration_window_service import (
    RegistrationQuotaExceededError,
    RegistrationWindowClosedError,
    RegistrationWindowNotFoundError,
    activate_window_by_id,
    claim_registration_slot,
    claim_registration_slot_for_window,
    close_window_by_id,
    create_registration_window,
    get_active_registration_window,
    list_windows,
    rollback_registration_slot,
)
from app.services.users.user_admin_service import UserAdminService
from app.services.users.user_provisioning_service import UserProvisioningService
from app.services.users.user_service import UserService

__all__ = [
    "AuthService",
    "DesktopOAuthError",
    "DesktopOAuthService",
    "InviteCodeService",
    "RegistrationPolicy",
    "RegistrationQuotaExceededError",
    "RegistrationWindowClosedError",
    "RegistrationWindowNotFoundError",
    "UserAdminService",
    "UserProvisioningService",
    "UserService",
    "activate_window_by_id",
    "claim_registration_slot",
    "claim_registration_slot_for_window",
    "close_window_by_id",
    "create_registration_window",
    "get_active_registration_window",
    "list_windows",
    "rollback_registration_slot",
]
