package kr.farmassi.app.autosms;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 웹(src/lib/autoSms.ts)이 저장한 설정 JSON 을 읽는다. 필드 이름은 양쪽이 같아야 한다.
 */
final class AutoSmsConfig {

    static final String DEFAULT_JSON =
        "{\"master\":false,\"popupWhenOff\":true,\"message\":\"\",\"exclusions\":[],"
            + "\"rules\":[{\"id\":\"default-missed\",\"name\":\"부재중 전화\",\"enabled\":true,"
            + "\"events\":[\"missed\"],\"days\":[0,1,2,3,4,5,6],\"start\":\"00:00\",\"end\":\"00:00\","
            + "\"frequency\":\"always\",\"frequencyDays\":1}]}";

    final boolean master;
    final boolean popupWhenOff;
    final String message;
    final List<Rule> rules = new ArrayList<>();
    final Set<String> excludedNumbers = new HashSet<>();

    private AutoSmsConfig(JSONObject json) {
        master = json.optBoolean("master", false);
        popupWhenOff = json.optBoolean("popupWhenOff", true);
        message = json.optString("message", "");

        JSONArray ruleArray = json.optJSONArray("rules");
        if (ruleArray != null) {
            for (int i = 0; i < ruleArray.length(); i++) {
                JSONObject rule = ruleArray.optJSONObject(i);
                if (rule != null) rules.add(new Rule(rule));
            }
        }

        JSONArray exclusionArray = json.optJSONArray("exclusions");
        if (exclusionArray != null) {
            for (int i = 0; i < exclusionArray.length(); i++) {
                JSONObject row = exclusionArray.optJSONObject(i);
                if (row == null) continue;
                String digits = PhoneNumbers.normalize(row.optString("phone", ""));
                if (!digits.isEmpty()) excludedNumbers.add(digits);
            }
        }
    }

    static AutoSmsConfig parse(String json) {
        try {
            return new AutoSmsConfig(new JSONObject(json));
        } catch (Exception e) {
            try {
                return new AutoSmsConfig(new JSONObject(DEFAULT_JSON));
            } catch (Exception impossible) {
                throw new IllegalStateException(impossible);
            }
        }
    }

    /** 목록 위쪽 규칙이 우선한다. 첫 번째로 맞는 규칙 하나만 쓴다. */
    Rule findRule(CallEvent event, Calendar at) {
        for (Rule rule : rules) {
            if (rule.matches(event, at)) return rule;
        }
        return null;
    }

    static final class Rule {
        final String id;
        final String name;
        final boolean enabled;
        final Set<String> events = new HashSet<>();
        final Set<Integer> days = new HashSet<>();
        final int startMinute;
        final int endMinute;
        /** daily | weekly | once | days */
        final String frequency;
        final int frequencyDays;

        Rule(JSONObject json) {
            id = json.optString("id", "");
            name = json.optString("name", "");
            enabled = json.optBoolean("enabled", true);
            JSONArray eventArray = json.optJSONArray("events");
            if (eventArray != null) {
                for (int i = 0; i < eventArray.length(); i++) events.add(eventArray.optString(i));
            }
            JSONArray dayArray = json.optJSONArray("days");
            if (dayArray != null) {
                for (int i = 0; i < dayArray.length(); i++) days.add(dayArray.optInt(i));
            }
            startMinute = parseMinute(json.optString("start", "00:00"));
            endMinute = parseMinute(json.optString("end", "00:00"));
            frequency = json.optString("frequency", "always");
            frequencyDays = Math.max(1, json.optInt("frequencyDays", 1));
        }

        boolean matches(CallEvent event, Calendar at) {
            if (!enabled || !events.contains(event.key)) return false;
            // 요일은 통화가 끝난 날 기준. Calendar 는 일요일이 1 이고 웹은 0 이다.
            int day = at.get(Calendar.DAY_OF_WEEK) - 1;
            if (!days.contains(day)) return false;
            int minute = at.get(Calendar.HOUR_OF_DAY) * 60 + at.get(Calendar.MINUTE);
            return inTimeWindow(minute);
        }

        /** 시작과 끝이 같으면 하루 종일, 시작이 끝보다 늦으면 자정을 넘기는 구간. */
        boolean inTimeWindow(int minute) {
            if (startMinute == endMinute) return true;
            if (startMinute < endMinute) return minute >= startMinute && minute < endMinute;
            return minute >= startMinute || minute < endMinute;
        }

        /** 같은 번호에 이 규칙으로 마지막 보낸 시각을 받아 이번에 보내도 되는지 판단한다. */
        boolean frequencyAllows(Long lastSentAt, long now) {
            if (lastSentAt == null) return true;
            switch (frequency) {
                case "always":
                    return true;
                case "once":
                    return false;
                case "weekly":
                    return now - lastSentAt >= 7L * 24 * 60 * 60 * 1000;
                case "days":
                    return now - lastSentAt >= frequencyDays * 24L * 60 * 60 * 1000;
                case "daily":
                default:
                    return !sameDay(lastSentAt, now);
            }
        }

        private static boolean sameDay(long a, long b) {
            Calendar ca = Calendar.getInstance();
            ca.setTimeInMillis(a);
            Calendar cb = Calendar.getInstance();
            cb.setTimeInMillis(b);
            return ca.get(Calendar.YEAR) == cb.get(Calendar.YEAR)
                && ca.get(Calendar.DAY_OF_YEAR) == cb.get(Calendar.DAY_OF_YEAR);
        }

        private static int parseMinute(String hhmm) {
            try {
                String[] parts = hhmm.split(":");
                int hour = Integer.parseInt(parts[0]);
                int minute = parts.length > 1 ? Integer.parseInt(parts[1]) : 0;
                return Math.max(0, Math.min(24 * 60 - 1, hour * 60 + minute));
            } catch (Exception e) {
                return 0;
            }
        }
    }
}
