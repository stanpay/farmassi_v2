package kr.farmassi.app.autosms;

final class PhoneNumbers {

    private PhoneNumbers() {}

    /** 숫자만 남기고 +82 국가번호는 0 으로 바꾼다. */
    static String normalize(String raw) {
        if (raw == null) return "";
        String digits = raw.replaceAll("[^0-9]", "");
        if (digits.startsWith("82") && raw.trim().startsWith("+")) digits = "0" + digits.substring(2);
        return digits;
    }

    /** 휴대폰 번호만 문자 대상. 지역번호(02, 031 …), 070, 15xx 대표번호는 제외된다. */
    static boolean isMobile(String digits) {
        return digits.matches("01[016789]\\d{7,8}");
    }

    static String format(String digits) {
        if (digits.length() == 11) {
            return digits.substring(0, 3) + "-" + digits.substring(3, 7) + "-" + digits.substring(7);
        }
        if (digits.length() == 10) {
            return digits.substring(0, 3) + "-" + digits.substring(3, 6) + "-" + digits.substring(6);
        }
        return digits;
    }
}
