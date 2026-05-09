from pydantic import BaseModel
from typing import Literal


class AffectedStock(BaseModel):
    symbol: str
    name: str
    matchType: Literal["direct", "keyword", "concept"] = "direct"


class NewsSentimentItem(BaseModel):
    id: str
    title: str
    content: str = ""
    source: str
    publishTime: str
    url: str = ""
    sentiment: Literal["positive", "neutral", "negative"]
    sentimentScore: int = 50  # 0-100
    importance: int = 50  # 0-100
    topics: list[str] = []
    affectedStocks: list[AffectedStock] = []
    keywords: list[str] = []


class SentimentTrend(BaseModel):
    date: str
    score: int
    positiveCount: int
    negativeCount: int
    neutralCount: int
    totalCount: int
    topTopic: str = ""


class TopicCluster(BaseModel):
    topic: str
    count: int
    sentiment: Literal["positive", "neutral", "negative"]
    avgScore: int
    trend: Literal["up", "down", "flat"] = "flat"
    recentTitles: list[str] = []


class NewsAlert(BaseModel):
    id: str
    title: str
    reason: str
    sentiment: Literal["positive", "neutral", "negative"]
    importance: int
    publishTime: str


class NewsSentimentOverview(BaseModel):
    updatedAt: str
    totalCount: int
    positiveCount: int
    negativeCount: int
    neutralCount: int
    overallScore: int  # 0-100
    marketPhase: str
    trends: list[SentimentTrend]
    hotTopics: list[TopicCluster]
    alerts: list[NewsAlert]
    topAffectedStocks: list[AffectedStock]


class PaginatedNewsFeed(BaseModel):
    items: list[NewsSentimentItem]
    total: int
    page: int
    pageSize: int
