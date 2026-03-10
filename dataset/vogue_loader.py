import json
import pandas as pd
from pathlib import Path
from typing import Dict, Any, List


class VogueDataset:
    """
    Simple loader for the VOGUE conversational fashion dataset.
    """

    def __init__(self, root: str = "data"):
        self.root = Path(root)

        # main directories
        self.convo_dir = self.root / "conversations"
        self.profile_dir = self.root / "fashion_profiles"
        self.item_ratings_dir = self.root / "item_ratings"
        self.meta_dir = self.root / "metadata"

        # preload CSVs
        self.profiles = pd.read_csv(self.profile_dir / "profiles.csv")
        self.profile_ratings = pd.read_csv(self.profile_dir / "ratings.csv")
        self.seeker_ratings = pd.read_csv(self.item_ratings_dir / "seeker_ratings.csv")
        self.assistant_ratings = pd.read_csv(
            self.item_ratings_dir / "assistant_ratings.csv"
        )

    # --------- Conversations ---------
    def list_conversations(self) -> List[str]:
        return sorted([p.name for p in self.convo_dir.glob("*.json")])

    def load_conversation(self, fname: str) -> Dict[str, Any]:
        path = self.convo_dir / fname
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)

    def get_conversation(self, convo_id: int) -> Dict[str, Any]:
        matches = [p for p in self.convo_dir.glob(f"c{convo_id}_*.json")]
        if not matches:
            raise FileNotFoundError(f"No conversation file found for ID {convo_id}")
        return self.load_conversation(matches[0].name)

    # --------- Metadata ---------
    def load_item(self, item_id: int) -> Dict[str, Any]:
        path = self.meta_dir / f"item_{item_id}.json"
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)

    # --------- Ratings ---------
    def get_seeker_ratings(self) -> pd.DataFrame:
        return self.seeker_ratings.copy()

    def get_assistant_ratings(self) -> pd.DataFrame:
        return self.assistant_ratings.copy()

    def get_profile_ratings(self) -> pd.DataFrame:
        return self.profile_ratings.copy()

    # --------- Profiles ---------
    def get_profiles(self) -> pd.DataFrame:
        return self.profiles.copy()


if __name__ == "__main__":
    # Example usage
    vogue = VogueDataset("data")

    # --- Conversations ---
    conv_list = vogue.list_conversations()
    print("Number of conversations:", len(conv_list))
    print("First 5 conversation files:", conv_list[:5])

    convo = vogue.get_conversation(1)
    print("\nConversation 1")
    print("- ID:", convo["conversation_id"])
    print("- Scenario:", convo["scenario"])
    print("- Catalogue:", convo["catalogue"])
    print("- Number of turns:", len(convo["conversation_content"]))
    print("- First turn:", json.dumps(convo["conversation_content"][0], indent=2))

    # --- Metadata ---
    item = vogue.load_item(1)
    print("\nExample item (ID=1):")
    print("- Name:", item["product_name"])
    print("- Brand:", item["product_brand"])
    print("- Categories:", " > ".join(item["categories"]))
    print("- Features:", "; ".join(item["about_product"][:3]), "...")

    # --- Ratings ---
    seekers = vogue.get_seeker_ratings()
    assistants = vogue.get_assistant_ratings()
    print("\nRatings overview:")
    print("- Seeker ratings shape:", seekers.shape)
    print("- Assistant ratings shape:", assistants.shape)

    seeker_item_cols = [c for c in seekers.columns if c.startswith("item_")]
    all_seeker_ratings = seekers[seeker_item_cols].stack()
    all_seeker_ratings = pd.to_numeric(all_seeker_ratings, errors="coerce")
    all_seeker_ratings = all_seeker_ratings[
        (all_seeker_ratings >= 1) & (all_seeker_ratings <= 5)
    ]
    print("- Total seeker ratings:", int(all_seeker_ratings.count()))
    print("- Average seeker rating:", round(all_seeker_ratings.mean(), 2))
    print("- Rating distribution:\n", all_seeker_ratings.value_counts().sort_index())

    # --- Profiles ---
    profiles = vogue.get_profiles()
    print("\nProfiles overview:")
    print("- Number of participants:", len(profiles))
    print("- Example participant:")
    print(profiles.iloc[0].to_dict())
