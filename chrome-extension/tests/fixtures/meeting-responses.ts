// Captured by companion/tests/meeting-close-contract-488.test.ts through handleMessage + actual WS envelope.
export const meetingResponses = {
  "created": {
    "request": {
      "title": "Synthetic receipt fixture",
      "thread_id": "thread-fixture",
      "type": "meeting.create",
      "v": 1,
      "id": "meeting-contract-1"
    },
    "response": {
      "type": "meeting.created",
      "v": 1,
      "meeting": {
        "id": "mtg_632eb33814176c9e",
        "thread_id": "thread-fixture",
        "title": "Synthetic receipt fixture",
        "started_at": "2026-09-09T02:34:05.839Z",
        "ended_at": null,
        "status": "draft",
        "privacy": {
          "stt_engine": "none",
          "audio_retained": false,
          "retain_until": null
        },
        "diarize": null,
        "transcript": [],
        "minutes": null,
        "error": null
      },
      "id": "meeting-contract-1"
    }
  },
  "started": {
    "request": {
      "meeting_id": "mtg_632eb33814176c9e",
      "privacy_ack_v1": true,
      "type": "meeting.start",
      "v": 1,
      "id": "meeting-contract-2"
    },
    "response": {
      "type": "meeting.started",
      "v": 1,
      "meeting": {
        "id": "mtg_632eb33814176c9e",
        "thread_id": "thread-fixture",
        "title": "Synthetic receipt fixture",
        "started_at": "2026-09-09T02:34:05.839Z",
        "ended_at": null,
        "status": "recording",
        "privacy": {
          "stt_engine": "local",
          "audio_retained": false,
          "retain_until": null
        },
        "diarize": null,
        "error": null,
        "transcript": [],
        "minutes": null
      },
      "id": "meeting-contract-2"
    }
  },
  "appended": {
    "request": {
      "meeting_id": "mtg_632eb33814176c9e",
      "text": "你好",
      "source": "stt",
      "type": "meeting.append_transcript",
      "v": 1,
      "id": "meeting-contract-3"
    },
    "response": {
      "type": "meeting.updated",
      "v": 1,
      "meeting": {
        "id": "mtg_632eb33814176c9e",
        "thread_id": "thread-fixture",
        "title": "Synthetic receipt fixture",
        "started_at": "2026-09-09T02:34:05.839Z",
        "ended_at": null,
        "status": "recording",
        "privacy": {
          "stt_engine": "local",
          "audio_retained": false,
          "retain_until": null
        },
        "diarize": null,
        "error": null,
        "transcript": [
          {
            "text": "你好",
            "source": "stt"
          }
        ],
        "minutes": null
      },
      "id": "meeting-contract-3"
    }
  },
  "oldRead": {
    "request": {
      "meeting_id": "mtg_632eb33814176c9e",
      "type": "meeting.get",
      "v": 1,
      "id": "meeting-contract-4"
    },
    "response": {
      "type": "meeting.get_result",
      "v": 1,
      "meeting": {
        "id": "mtg_632eb33814176c9e",
        "thread_id": "thread-fixture",
        "title": "Synthetic receipt fixture",
        "started_at": "2026-09-09T02:34:05.839Z",
        "ended_at": null,
        "status": "recording",
        "privacy": {
          "stt_engine": "local",
          "audio_retained": false,
          "retain_until": null
        },
        "diarize": null,
        "error": null,
        "transcript": [
          {
            "text": "你好",
            "source": "stt"
          }
        ],
        "minutes": null
      },
      "id": "meeting-contract-4"
    }
  },
  "suffix": {
    "request": {
      "meeting_id": "mtg_632eb33814176c9e",
      "text": "好",
      "source": "stt",
      "type": "meeting.append_transcript",
      "v": 1,
      "id": "meeting-contract-5"
    },
    "response": {
      "type": "meeting.updated",
      "v": 1,
      "meeting": {
        "id": "mtg_632eb33814176c9e",
        "thread_id": "thread-fixture",
        "title": "Synthetic receipt fixture",
        "started_at": "2026-09-09T02:34:05.839Z",
        "ended_at": null,
        "status": "recording",
        "privacy": {
          "stt_engine": "local",
          "audio_retained": false,
          "retain_until": null
        },
        "diarize": null,
        "error": null,
        "transcript": [
          {
            "text": "你好",
            "source": "stt"
          },
          {
            "text": "好",
            "source": "stt"
          }
        ],
        "minutes": null
      },
      "id": "meeting-contract-5"
    }
  },
  "repeated": {
    "request": {
      "meeting_id": "mtg_632eb33814176c9e",
      "text": "好",
      "source": "stt",
      "type": "meeting.append_transcript",
      "v": 1,
      "id": "meeting-contract-6"
    },
    "response": {
      "type": "meeting.updated",
      "v": 1,
      "meeting": {
        "id": "mtg_632eb33814176c9e",
        "thread_id": "thread-fixture",
        "title": "Synthetic receipt fixture",
        "started_at": "2026-09-09T02:34:05.839Z",
        "ended_at": null,
        "status": "recording",
        "privacy": {
          "stt_engine": "local",
          "audio_retained": false,
          "retain_until": null
        },
        "diarize": null,
        "error": null,
        "transcript": [
          {
            "text": "你好",
            "source": "stt"
          },
          {
            "text": "好",
            "source": "stt"
          },
          {
            "text": "好",
            "source": "stt"
          }
        ],
        "minutes": null
      },
      "id": "meeting-contract-6"
    }
  },
  "replaced": {
    "request": {
      "meeting_id": "mtg_632eb33814176c9e",
      "text": "你好\n好\n好",
      "source": "user_edit",
      "silence_cut": false,
      "type": "meeting.set_transcript",
      "v": 1,
      "id": "meeting-contract-7"
    },
    "response": {
      "type": "meeting.updated",
      "v": 1,
      "meeting": {
        "id": "mtg_632eb33814176c9e",
        "thread_id": "thread-fixture",
        "title": "Synthetic receipt fixture",
        "started_at": "2026-09-09T02:34:05.839Z",
        "ended_at": null,
        "status": "recording",
        "privacy": {
          "stt_engine": "local",
          "audio_retained": false,
          "retain_until": null
        },
        "diarize": null,
        "error": null,
        "transcript": [
          {
            "text": "你好",
            "source": "user_edit"
          },
          {
            "text": "好",
            "source": "user_edit"
          },
          {
            "text": "好",
            "source": "user_edit"
          }
        ],
        "minutes": null
      },
      "id": "meeting-contract-7"
    }
  },
  "read": {
    "request": {
      "meeting_id": "mtg_632eb33814176c9e",
      "type": "meeting.get",
      "v": 1,
      "id": "meeting-contract-8"
    },
    "response": {
      "type": "meeting.get_result",
      "v": 1,
      "meeting": {
        "id": "mtg_632eb33814176c9e",
        "thread_id": "thread-fixture",
        "title": "Synthetic receipt fixture",
        "started_at": "2026-09-09T02:34:05.839Z",
        "ended_at": null,
        "status": "recording",
        "privacy": {
          "stt_engine": "local",
          "audio_retained": false,
          "retain_until": null
        },
        "diarize": null,
        "error": null,
        "transcript": [
          {
            "text": "你好",
            "source": "user_edit"
          },
          {
            "text": "好",
            "source": "user_edit"
          },
          {
            "text": "好",
            "source": "user_edit"
          }
        ],
        "minutes": null
      },
      "id": "meeting-contract-8"
    }
  },
  "ended": {
    "request": {
      "meeting_id": "mtg_632eb33814176c9e",
      "type": "meeting.end",
      "v": 1,
      "id": "meeting-contract-9"
    },
    "response": {
      "type": "meeting.ended",
      "v": 1,
      "meeting": {
        "id": "mtg_632eb33814176c9e",
        "thread_id": "thread-fixture",
        "title": "Synthetic receipt fixture",
        "started_at": "2026-09-09T02:34:05.839Z",
        "ended_at": "2026-09-09T02:34:05.843Z",
        "status": "ready",
        "privacy": {
          "stt_engine": "local",
          "audio_retained": false,
          "retain_until": null
        },
        "diarize": null,
        "error": null,
        "transcript": [
          {
            "text": "你好",
            "source": "user_edit"
          },
          {
            "text": "好",
            "source": "user_edit"
          },
          {
            "text": "好",
            "source": "user_edit"
          }
        ],
        "minutes": null
      },
      "audio_deleted": true,
      "id": "meeting-contract-9"
    }
  },
  "endedAgain": {
    "request": {
      "meeting_id": "mtg_632eb33814176c9e",
      "type": "meeting.end",
      "v": 1,
      "id": "meeting-contract-10"
    },
    "response": {
      "type": "meeting.ended",
      "v": 1,
      "meeting": {
        "id": "mtg_632eb33814176c9e",
        "thread_id": "thread-fixture",
        "title": "Synthetic receipt fixture",
        "started_at": "2026-09-09T02:34:05.839Z",
        "ended_at": "2026-09-09T02:34:05.844Z",
        "status": "ready",
        "privacy": {
          "stt_engine": "local",
          "audio_retained": false,
          "retain_until": null
        },
        "diarize": null,
        "error": null,
        "transcript": [
          {
            "text": "你好",
            "source": "user_edit"
          },
          {
            "text": "好",
            "source": "user_edit"
          },
          {
            "text": "好",
            "source": "user_edit"
          }
        ],
        "minutes": null
      },
      "audio_deleted": true,
      "id": "meeting-contract-10"
    }
  },
  "denied": {
    "request": {
      "meeting_id": "mtg_632eb33814176c9e",
      "text": "拒绝",
      "silence_cut": false,
      "type": "meeting.set_transcript",
      "v": 1,
      "id": "meeting-contract-11"
    },
    "response": {
      "type": "meeting.error",
      "v": 1,
      "code": "origin_denied",
      "message": "chrome-extension origin required",
      "id": "meeting-contract-11"
    }
  }
} as const
