import type { Chapter, ChapterContent, Story } from '../types';

export const mockStories: Story[] = [
  {
    id: 'than-dao-chi-ton',
    title: 'Thần Đạo Chí Tôn',
    status: 'Đang ra',
    totalChapters: 128,
    genres: ['Tiên hiệp', 'Huyền huyễn', 'Hành động'],
    summary: 'Thiếu niên bị phế bỏ tu vi, đẩy vào vực sâu tuyệt vọng. Ngàn năm huyết hận, một đường nghịch thiên.',
    description:
      'Từng là thiên tài của Thanh Vân Tông, Dạ Huyền bị chính vị hôn thê phản bội, bị phế bỏ tu vi và đẩy xuống vực sâu chết chóc. Nhưng trời không tuyệt đường người, trong vực sâu, hắn ngộ đại đạo, tái sinh mạnh mẽ, bước lên con đường nghịch thiên cải mệnh.',
    updatedAt: '2026-06-28T10:00:00.000Z',
    coverUrl: '/api/stories/than-dao-chi-ton/cover',
  },
  {
    id: 'gap-em-la-dinh-menh',
    title: 'Gặp Em Là Định Mệnh',
    status: 'Đang ra',
    totalChapters: 36,
    genres: ['Ngôn tình', 'Đô thị', 'Chữa lành'],
    summary: 'Một cuộc gặp tình cờ trong đêm mưa kéo hai trái tim cô độc vào cùng một quỹ đạo dịu dàng.',
    description:
      'Linh An từng nghĩ đời mình chỉ còn những ngày làm việc lặng lẽ và căn hộ nhỏ cuối phố. Cho đến khi cô gặp Minh Khang, người đàn ông luôn mang theo một chiếc ô xanh và nụ cười khiến mùa mưa bớt lạnh.',
    updatedAt: '2026-06-27T14:30:00.000Z',
    coverUrl: '/api/stories/gap-em-la-dinh-menh/cover',
  },
  {
    id: 'ngoi-lang-khong-ten',
    title: 'Ngôi Làng Không Tên',
    status: 'Hoàn thành',
    totalChapters: 22,
    genres: ['Bí ẩn', 'Kinh dị nhẹ', 'Phiêu lưu'],
    summary: 'Một phóng viên trẻ đi tìm ngôi làng biến mất khỏi mọi bản đồ và nghe thấy tiếng chuông sau nửa đêm.',
    description:
      'Sau khi nhận được cuộn băng ghi âm của người cha mất tích, Khánh men theo những tọa độ bị xóa khỏi hồ sơ cũ. Càng đến gần thung lũng sương mù, anh càng nhận ra có những nơi không muốn được gọi tên.',
    updatedAt: '2026-06-25T08:00:00.000Z',
    coverUrl: '/api/stories/ngoi-lang-khong-ten/cover',
  },
];

export const mockChapters = (storyId: string): Chapter[] => {
  const story = mockStories.find((item) => item.id === storyId);
  const total = story?.totalChapters ?? 8;
  return Array.from({ length: Math.min(total, 8) }, (_, index) => ({
    storyId,
    number: index + 1,
    title: chapterTitle(storyId, index + 1),
    filename: `${String(index + 1).padStart(3, '0')}.md`,
  }));
};

export const mockChapterContent = (storyId: string, chapterNumber: number): ChapterContent => ({
  storyId,
  number: chapterNumber,
  title: chapterTitle(storyId, chapterNumber),
  filename: `${String(chapterNumber).padStart(3, '0')}.md`,
  content: [
    `# ${chapterTitle(storyId, chapterNumber)}`,
    '',
    'Gió sớm lùa qua mái hiên, để lại trên bậc đá một lớp hơi nước mỏng như tơ. Người thiếu niên mở mắt giữa khoảng lặng dài, nghe rõ nhịp tim mình đang trở lại từng chút một.',
    '',
    'Ở phía xa, tiếng chuông cổ ngân lên ba hồi. Mỗi hồi chuông như kéo ký ức ngủ quên từ tận đáy sâu tỉnh dậy, chậm rãi mà sắc bén.',
    '',
    'Hắn đứng dậy, phủi bụi trên vai áo. Con đường trước mặt vẫn phủ đầy sương, nhưng lần đầu tiên sau rất nhiều ngày, hắn biết mình phải đi về đâu.',
    '',
    'Đêm qua còn là vực sâu. Sáng nay, mọi thứ đã bắt đầu đổi hướng.',
  ].join('\n'),
});

function chapterTitle(storyId: string, number: number) {
  const titles: Record<string, string[]> = {
    'than-dao-chi-ton': [
      'Thiên mệnh thức tỉnh',
      'Bước vào cổ trận',
      'Huyết chiến trên đỉnh',
      'Cửa ải cuối cùng',
      'Chân tướng dần lộ',
    ],
    'gap-em-la-dinh-menh': ['Chiếc ô màu xanh', 'Quán cà phê cuối phố', 'Tin nhắn lúc nửa đêm'],
    'ngoi-lang-khong-ten': ['Tiếng chuông trong sương', 'Tấm bản đồ bị xóa', 'Người gác cổng cũ'],
  };
  return titles[storyId]?.[number - 1] ?? `Chương ${String(number).padStart(3, '0')}`;
}
