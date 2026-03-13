#!/usr/bin/env python3
"""Preprocess VOGUE dataset into a single JSON file for the web dashboard."""

import json
import csv
import os
import glob

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'dataset', 'data')
OUT = os.path.join(os.path.dirname(__file__), 'data.json')


def load_items():
    items = []
    for i in range(1, 37):
        path = os.path.join(DATA_DIR, 'metadata', f'item_{i}.json')
        with open(path) as f:
            items.append(json.load(f))
    return items


def load_scenarios():
    with open(os.path.join(DATA_DIR, 'conversation_trials', 'scenarios.json')) as f:
        return json.load(f)


def load_conversations():
    convs = []
    pattern = os.path.join(DATA_DIR, 'conversation_trials', 'transcripts', '*.json')
    for path in sorted(glob.glob(pattern)):
        with open(path) as f:
            convs.append(json.load(f))
    convs.sort(key=lambda c: c['conversation_id'])
    return convs


def load_csv(path):
    with open(path, newline='') as f:
        return list(csv.DictReader(f))


def load_profiles():
    return load_csv(os.path.join(DATA_DIR, 'fashion_profiles', 'profiles.csv'))


def load_seeker_ratings():
    return load_csv(os.path.join(DATA_DIR, 'conversation_trials', 'item_ratings', 'seeker_ratings.csv'))


def load_assistant_ratings():
    return load_csv(os.path.join(DATA_DIR, 'conversation_trials', 'item_ratings', 'assistant_ratings.csv'))


def compute_stats(conversations, items, profiles):
    total_turns = sum(len(c['conversation_content']) for c in conversations)
    all_tags = []
    for c in conversations:
        for turn in c['conversation_content']:
            for tag_list in turn['content']['tags']:
                all_tags.extend(tag_list)
    tag_counts = {}
    for t in all_tags:
        tag_counts[t] = tag_counts.get(t, 0) + 1
    # Sort by count descending
    tag_counts = dict(sorted(tag_counts.items(), key=lambda x: -x[1]))

    # Conversation lengths
    conv_lengths = [len(c['conversation_content']) for c in conversations]

    # Items mentioned frequency
    item_freq = {}
    for c in conversations:
        for item_id in c.get('mentioned_items', []):
            item_freq[item_id] = item_freq.get(item_id, 0) + 1

    # Ground truth items frequency
    gt_freq = {}
    for c in conversations:
        for item_id in c.get('gt_items', []):
            gt_freq[item_id] = gt_freq.get(item_id, 0) + 1

    return {
        'totalConversations': len(conversations),
        'totalItems': len(items),
        'totalParticipants': len(profiles),
        'totalTurns': total_turns,
        'avgTurnsPerConversation': round(total_turns / len(conversations), 1),
        'tagCounts': tag_counts,
        'conversationLengths': conv_lengths,
        'itemMentionFrequency': {str(k): v for k, v in sorted(item_freq.items())},
        'groundTruthFrequency': {str(k): v for k, v in sorted(gt_freq.items())},
    }


def main():
    items = load_items()
    scenarios = load_scenarios()
    conversations = load_conversations()
    profiles = load_profiles()
    seeker_ratings = load_seeker_ratings()
    assistant_ratings = load_assistant_ratings()
    stats = compute_stats(conversations, items, profiles)

    data = {
        'items': items,
        'scenarios': scenarios,
        'conversations': conversations,
        'profiles': profiles,
        'seekerRatings': seeker_ratings,
        'assistantRatings': assistant_ratings,
        'stats': stats,
    }

    with open(OUT, 'w') as f:
        json.dump(data, f, separators=(',', ':'))

    size_kb = os.path.getsize(OUT) / 1024
    print(f"Generated {OUT} ({size_kb:.1f} KB)")


if __name__ == '__main__':
    main()
