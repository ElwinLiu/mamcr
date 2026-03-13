#!/usr/bin/env python3
"""Preprocess MAMCR SQLite database into a single JSON file for the web dashboard."""

import json
import os
import sqlite3

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'mamcr.db')
OUT = os.path.join(os.path.dirname(__file__), 'data.json')


def dict_factory(cursor, row):
    return {col[0]: row[idx] for idx, col in enumerate(cursor.description)}


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = dict_factory
    cur = conn.cursor()

    # Users
    users = cur.execute('SELECT * FROM users').fetchall()

    # Items
    items = cur.execute('SELECT item_id, catalogue, name, brand, rating, categories, description, about, details, reviews FROM items').fetchall()
    for item in items:
        for field in ('categories', 'about', 'details', 'reviews'):
            if item[field]:
                try:
                    item[field] = json.loads(item[field])
                except (json.JSONDecodeError, TypeError):
                    pass

    # Scenarios
    scenarios = cur.execute('SELECT * FROM scenarios').fetchall()

    # Conversations with turns
    convs = cur.execute('SELECT * FROM conversations ORDER BY conv_id').fetchall()
    for conv in convs:
        for field in ('mentioned_items', 'gt_items'):
            if conv[field]:
                try:
                    conv[field] = json.loads(conv[field])
                except (json.JSONDecodeError, TypeError):
                    pass
        turns = cur.execute(
            'SELECT turn, role, content, tags FROM conversation_turns WHERE conv_id = ? ORDER BY turn',
            (conv['conv_id'],)
        ).fetchall()
        for t in turns:
            if t['tags']:
                try:
                    t['tags'] = json.loads(t['tags'])
                except (json.JSONDecodeError, TypeError):
                    pass
        conv['turns'] = turns

    # Ratings (normalized)
    ratings = cur.execute('SELECT * FROM ratings').fetchall()

    # User preferences
    preferences = cur.execute('SELECT * FROM user_preferences ORDER BY user_id, source_conv_id').fetchall()

    # Compute stats
    total_turns = cur.execute('SELECT COUNT(*) as c FROM conversation_turns').fetchone()['c']

    # Tag counts
    all_tags_raw = cur.execute('SELECT tags FROM conversation_turns').fetchall()
    tag_counts = {}
    for row in all_tags_raw:
        if row['tags']:
            try:
                tag_lists = json.loads(row['tags']) if isinstance(row['tags'], str) else row['tags']
                for tag_list in tag_lists:
                    if isinstance(tag_list, list):
                        for tag in tag_list:
                            tag_counts[tag] = tag_counts.get(tag, 0) + 1
            except (json.JSONDecodeError, TypeError):
                pass
    tag_counts = dict(sorted(tag_counts.items(), key=lambda x: -x[1]))

    # Conversation lengths
    conv_lengths = cur.execute(
        'SELECT conv_id, COUNT(*) as turns FROM conversation_turns GROUP BY conv_id ORDER BY conv_id'
    ).fetchall()

    # Item mention & ground truth frequency
    item_mention_freq = {}
    gt_freq = {}
    for conv in convs:
        for item_id in (conv.get('mentioned_items') or []):
            item_mention_freq[item_id] = item_mention_freq.get(item_id, 0) + 1
        for item_id in (conv.get('gt_items') or []):
            gt_freq[item_id] = gt_freq.get(item_id, 0) + 1

    # Rating distribution
    rating_dist = {}
    for r in ratings:
        v = r['rating']
        rating_dist[v] = rating_dist.get(v, 0) + 1

    # Per-user avg rating
    user_avg_ratings = {}
    user_rating_counts = {}
    for r in ratings:
        uid = r['user_id']
        user_avg_ratings[uid] = user_avg_ratings.get(uid, 0) + r['rating']
        user_rating_counts[uid] = user_rating_counts.get(uid, 0) + 1
    for uid in user_avg_ratings:
        user_avg_ratings[uid] = round(user_avg_ratings[uid] / user_rating_counts[uid], 2)

    # Preferences per user
    prefs_per_user = {}
    for p in preferences:
        uid = p['user_id']
        prefs_per_user[uid] = prefs_per_user.get(uid, 0) + 1

    stats = {
        'totalConversations': len(convs),
        'totalUsers': len(users),
        'totalItems': len(items),
        'totalTurns': total_turns,
        'totalRatings': len(ratings),
        'totalPreferences': len(preferences),
        'avgTurnsPerConversation': round(total_turns / len(convs), 1),
        'tagCounts': tag_counts,
        'conversationLengths': [cl['turns'] for cl in conv_lengths],
        'itemMentionFrequency': {str(k): v for k, v in sorted(item_mention_freq.items())},
        'groundTruthFrequency': {str(k): v for k, v in sorted(gt_freq.items())},
        'ratingDistribution': rating_dist,
        'userAvgRatings': user_avg_ratings,
        'prefsPerUser': prefs_per_user,
    }

    data = {
        'users': users,
        'items': items,
        'scenarios': scenarios,
        'conversations': convs,
        'ratings': ratings,
        'preferences': preferences,
        'stats': stats,
    }

    with open(OUT, 'w') as f:
        json.dump(data, f, separators=(',', ':'))

    size_kb = os.path.getsize(OUT) / 1024
    print(f"Generated {OUT} ({size_kb:.1f} KB)")

    conn.close()


if __name__ == '__main__':
    main()
