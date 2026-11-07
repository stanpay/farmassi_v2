package kr.farmassi.app.autosms;

/** 통화가 끝났을 때의 상황. 이름은 웹 설정(JSON)의 events 값과 같다. */
enum CallEvent {
    OUTGOING("outgoing", "발신"),
    INCOMING("incoming", "수신"),
    MISSED("missed", "부재중"),
    TEST("test", "테스트");

    final String key;
    final String label;

    CallEvent(String key, String label) {
        this.key = key;
        this.label = label;
    }

    static CallEvent fromKey(String key) {
        for (CallEvent event : values()) {
            if (event.key.equals(key)) return event;
        }
        return null;
    }
}
